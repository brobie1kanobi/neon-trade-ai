import { createClientFromRequest } from 'npm:@base44/sdk@0.7.0';

// Mock Bank Link service for demo purposes
// This simulates a real banking API without making external calls

const mockBankingService = {
    // Simulate connecting a bank account
    connectBankAccount: async ({ accountNumber, routingNumber, accountType, bankName }) => {
        // Simulate API processing delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Generate a mock account ID
        const accountId = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return {
            account_id: accountId,
            account_name: `${bankName} ***${accountNumber.slice(-4)}`,
            account_type: accountType,
            status: 'connected',
            balance: Math.floor(Math.random() * 10000) + 1000 // Random balance between $1000-$11000
        };
    },

    // Get connected bank accounts
    getBankAccounts: ({ userId }) => {
        // For demo, return empty array - accounts are stored in UserSettings
        return {
            accounts: [],
            total_count: 0
        };
    },

    // Simulate deposit transaction
    initiateDeposit: async ({ accountId, amount, currency = 'USD' }) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const transactionId = `dep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return {
            transaction_id: transactionId,
            status: 'completed', // In demo mode, complete immediately
            amount: amount,
            currency: currency,
            estimated_completion: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
        };
    },

    // Simulate withdrawal transaction
    initiateWithdrawal: async ({ accountId, amount, currency = 'USD' }) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const transactionId = `wth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        return {
            transaction_id: transactionId,
            status: 'pending', // Withdrawals typically take longer
            amount: amount,
            currency: currency,
            estimated_completion: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days from now
        };
    },

    // Check transaction status
    getTransactionStatus: async ({ transactionId }) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Mock different statuses based on transaction ID pattern
        if (transactionId.includes('dep_')) {
            return {
                transaction_id: transactionId,
                status: 'completed',
                processed_at: new Date().toISOString()
            };
        } else {
            return {
                transaction_id: transactionId,
                status: 'pending',
                estimated_completion: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
            };
        }
    },

    // Get account balance
    getAccountBalance: async ({ accountId }) => {
        await new Promise(resolve => setTimeout(resolve, 300));
        
        return {
            account_id: accountId,
            available_balance: Math.floor(Math.random() * 5000) + 2000,
            current_balance: Math.floor(Math.random() * 5500) + 2000,
            currency: 'USD'
        };
    },

    // Disconnect bank account
    disconnectBankAccount: async ({ accountId }) => {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return {
            account_id: accountId,
            status: 'disconnected',
            disconnected_at: new Date().toISOString()
        };
    }
};

const actions = {
    connectBankAccount: (payload) => {
        return mockBankingService.connectBankAccount(payload);
    },

    getBankAccounts: (payload) => {
        return mockBankingService.getBankAccounts(payload);
    },

    initiateDeposit: (payload) => {
        return mockBankingService.initiateDeposit(payload);
    },

    initiateWithdrawal: (payload) => {
        return mockBankingService.initiateWithdrawal(payload);
    },

    getTransactionStatus: (payload) => {
        return mockBankingService.getTransactionStatus(payload);
    },

    getAccountBalance: (payload) => {
        return mockBankingService.getAccountBalance(payload);
    },

    disconnectBankAccount: (payload) => {
        return mockBankingService.disconnectBankAccount(payload);
    }
};

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { action, payload } = await req.json();
        
        if (!action || !actions[action]) {
            return Response.json({ error: 'Invalid action' }, { status: 400 });
        }

        const result = await actions[action]({ ...payload, userId: user.id });
        
        return Response.json({ success: true, data: result });

    } catch (error) {
        console.error('Mock Bank Service error:', error);
        return Response.json({ 
            error: error.message,
            success: false 
        }, { status: 500 });
    }
});