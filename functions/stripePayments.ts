import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';
import Stripe from 'npm:stripe@14.25.0';

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"));
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

// --- IMPORTANT ---
// Load price IDs from environment variables (no hardcoding in production)
const SUBSCRIPTION_PRICE_ID = Deno.env.get("STRIPE_SUBSCRIPTION_PRICE_ID");
const PRO_PLAN_PRICE_ID = Deno.env.get("STRIPE_PRO_PLAN_PRICE_ID");

const actions = {
    // Create checkout session for credit packages
    createCreditsSession: async ({ packageType, userEmail, userId }) => {
        if (!SUBSCRIPTION_PRICE_ID) {
            console.error("Stripe subscription Price ID is not configured in environment variables");
            throw new Error("Stripe integration is not configured. Please contact support.");
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price: SUBSCRIPTION_PRICE_ID,
            }],
            mode: 'subscription',
            success_url: `${Deno.env.get("BASE44_APP_URL") || 'https://preview--neontrade.base44.app'}/PaymentSuccess?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
            cancel_url: `${Deno.env.get("BASE44_APP_URL") || 'https://preview--neontrade.base44.app'}/Settings?payment=cancelled`,
            customer_email: userEmail,
            metadata: {
                userId: userId,
                userEmail: userEmail,
                type: 'subscription',
                packageType: packageType || 'starter',
                app: 'neontrade'
            }
        });

        return { sessionId: session.id, url: session.url };
    },

    // Create subscription session for Pro plan
    createSubscriptionSession: async ({ userEmail, userId }) => {
        if (!PRO_PLAN_PRICE_ID) {
            console.error("Stripe Pro Plan Price ID is not configured in environment variables");
            throw new Error("Pro plan integration is not configured. Please contact support.");
        }

        // First create or get customer
        let customer;
        const existingCustomers = await stripe.customers.list({ email: userEmail, limit: 1 });
        
        if (existingCustomers.data.length > 0) {
            customer = existingCustomers.data[0];
        } else {
            customer = await stripe.customers.create({
                email: userEmail,
                metadata: { userId: userId, app: 'neontrade' }
            });
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{ price: PRO_PLAN_PRICE_ID, quantity: 1 }],
            mode: 'subscription',
            success_url: `${Deno.env.get("BASE44_APP_URL") || 'https://preview--neontrade.base44.app'}/PaymentSuccess?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
            cancel_url: `${Deno.env.get("BASE44_APP_URL") || 'https://preview--neontrade.base44.app'}/Settings?payment=cancelled`,
            customer: customer.id,
            metadata: {
                userId: userId,
                userEmail: userEmail,
                type: 'subscription',
                app: 'neontrade'
            }
        });

        return { sessionId: session.id, url: session.url };
    },

    // Verify payment and add credits/subscription
    verifyPaymentAndUpdate: async ({ sessionId, userEmail }) => {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        
        if (session.payment_status !== 'paid') {
            throw new Error('Payment not completed');
        }

        if (session.metadata.userEmail !== userEmail) {
            throw new Error('Session does not belong to user');
        }

        const base44 = createClientFromRequest(null, { serviceRole: true });

        const existingProcessedSessions = await base44.asServiceRole.entities.ProcessedSession.filter({
            session_id: sessionId
        });

        if (existingProcessedSessions.length > 0) {
            return { alreadyProcessed: true, ...existingProcessedSessions[0] };
        }

        let result = {};

        if (session.metadata.type === 'credits') {
            const credits = parseInt(session.metadata.credits);
            const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ created_by: userEmail });
            
            if (userSettings.length > 0) {
                const current = userSettings[0];
                await base44.asServiceRole.entities.UserSettings.update(current.id, {
                    credits_balance: (current.credits_balance || 0) + credits
                });
            } else {
                await base44.asServiceRole.entities.UserSettings.create({
                    credits_balance: credits,
                    created_by: userEmail
                });
            }
            
            result = { type: 'credits', credits_added: credits };

        } else if (session.metadata.type === 'subscription') {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ created_by: userEmail });
            
            if (userSettings.length > 0) {
                const current = userSettings[0];
                await base44.asServiceRole.entities.UserSettings.update(current.id, {
                    account_type: 'pro',
                    subscription_id: subscription.id,
                    subscription_status: subscription.status,
                    credits_balance: (current.credits_balance || 0) + 1000
                });
            } else {
                await base44.asServiceRole.entities.UserSettings.create({
                    account_type: 'pro',
                    subscription_id: subscription.id,
                    subscription_status: subscription.status,
                    credits_balance: 1000,
                    created_by: userEmail
                });
            }
            
            result = { type: 'subscription', subscription_id: subscription.id, credits_added: 1000 };
        }

        await base44.asServiceRole.entities.ProcessedSession.create({
            session_id: sessionId,
            user_email: userEmail,
            type: session.metadata.type,
            processed_at: new Date().toISOString(),
            result: JSON.stringify(result)
        });

        return result;
    },

    // Admin refund processing
    processRefund: async ({ sessionId, adminUserEmail }) => {
        const base44 = createClientFromRequest(null, { serviceRole: true });
        const adminUser = await base44.asServiceRole.entities.User.filter({ email: adminUserEmail });
        if (!adminUser[0] || adminUser[0].role !== 'admin') {
            throw new Error('Unauthorized: Admin access required');
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const userEmail = session.metadata.userEmail;

        const existingRefunds = await base44.asServiceRole.entities.ProcessedRefund.filter({
            session_id: sessionId
        });

        if (existingRefunds.length > 0) {
            return { alreadyProcessed: true, ...existingRefunds[0] };
        }

        let result = {};

        if (session.metadata.type === 'credits') {
            const credits = parseInt(session.metadata.credits);
            const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ created_by: userEmail });
            
            if (userSettings.length > 0) {
                const current = userSettings[0];
                const newBalance = Math.max(0, (current.credits_balance || 0) - credits);
                await base44.asServiceRole.entities.UserSettings.update(current.id, {
                    credits_balance: newBalance
                });
                result = { type: 'credits', credits_removed: credits, new_balance: newBalance };
            }

        } else if (session.metadata.type === 'subscription') {
            const subscription = await stripe.subscriptions.retrieve(session.subscription);
            await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
            
            const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ created_by: userEmail });
            
            if (userSettings.length > 0) {
                const current = userSettings[0];
                await base44.asServiceRole.entities.UserSettings.update(current.id, {
                    account_type: 'basic',
                    subscription_status: 'cancelled'
                });
                result = { type: 'subscription', subscription_cancelled: true };
            }
        }

        await base44.asServiceRole.entities.ProcessedRefund.create({
            session_id: sessionId,
            user_email: userEmail,
            admin_email: adminUserEmail,
            type: session.metadata.type,
            processed_at: new Date().toISOString(),
            result: JSON.stringify(result)
        });

        return result;
    },

    // Create a deposit session
    createDepositSession: async ({ amount, userEmail, userId }) => {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'NeonTrade AI - Account Deposit',
                        description: `Add $${amount} to your trading wallet`,
                        images: ['https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68b9d30ff048d7f24e2fe484/83b0737a9_7fed9c694_a365a9198_logo.png']
                    },
                    unit_amount: Math.round(amount * 100),
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${Deno.env.get("BASE44_APP_URL") || 'https://preview--neontrade.base44.app'}/Wallet?payment=success&amount=${amount}`,
            cancel_url: `${Deno.env.get("BASE44_APP_URL") || 'https://preview--neontrade.base44.app'}/Wallet?payment=cancelled`,
            customer_email: userEmail,
            metadata: {
                userId: userId,
                userEmail: userEmail,
                type: 'deposit',
                amount: amount.toString(),
                app: 'neontrade'
            }
        });

        return { sessionId: session.id, url: session.url };
    },

    // Handle webhooks
    handleWebhook: async ({ payload, signature }) => {
        let event;
        try {
            event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
        } catch (err) {
            throw new Error(`Webhook Error: ${err.message}`);
        }

        const base44 = createClientFromRequest(null, { serviceRole: true });

        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object, base44);
                break;
            case 'invoice.payment_succeeded':
                await handleSubscriptionRenewal(event.data.object, base44);
                break;
            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return { received: true };
    }
};

async function handleCheckoutSessionCompleted(session, base44) {
    const { userEmail, type, amount } = session.metadata;

    if (type === 'deposit') {
        const wallets = await base44.asServiceRole.entities.Wallet.filter({ created_by: userEmail });
        let wallet = wallets[0];

        const depositAmount = parseFloat(amount);

        if (wallet) {
            await base44.asServiceRole.entities.Wallet.update(wallet.id, {
                real_cash_balance: (wallet.real_cash_balance || 0) + depositAmount,
                real_total_deposits: (wallet.real_total_deposits || 0) + depositAmount
            });
        } else {
            await base44.asServiceRole.entities.Wallet.create({
                cash_balance: 0,
                portfolio_value: 0,
                total_deposits: 0,
                total_withdrawals: 0,
                real_cash_balance: depositAmount,
                real_portfolio_value: 0,
                real_total_deposits: depositAmount,
                real_total_withdrawals: 0,
                created_by: userEmail
            });
        }

        await base44.asServiceRole.entities.Transaction.create({
            type: 'deposit',
            amount: depositAmount,
            status: 'completed',
            bank_account: 'Stripe Payment',
            reference_id: session.id,
            is_real_money: true,
            created_by: userEmail
        });
    }
}

async function handleSubscriptionRenewal(invoice, base44) {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const customer = await stripe.customers.retrieve(subscription.customer);
    const userEmail = customer.email;

    const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ created_by: userEmail });
    
    if (userSettings.length > 0) {
        const current = userSettings[0];
        await base44.asServiceRole.entities.UserSettings.update(current.id, {
            credits_balance: (current.credits_balance || 0) + 1000,
            subscription_status: subscription.status
        });
    }
}

Deno.serve(async (req) => {
    try {
        const url = new URL(req.url);
        
        if (url.pathname.endsWith('/webhook')) {
            const signature = req.headers.get('stripe-signature');
            const payload = await req.text();
            const result = await actions.handleWebhook({ payload, signature });
            return Response.json(result);
        }

        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { action, payload } = await req.json();
        
        if (!action || !actions[action]) {
            return Response.json({ error: 'Invalid action' }, { status: 400 });
        }

        const result = await actions[action]({ 
            ...payload, 
            userEmail: user.email, 
            userId: user.id 
        });
        
        return Response.json({ success: true, data: result });

    } catch (error) {
        console.error('Stripe integration error:', error);
        return Response.json({ 
            error: error.message,
            success: false 
        }, { status: 500 });
    }
});
