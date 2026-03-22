// Updated to support categories, crypto brokers, real login URLs, and no fake auto-connect
import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

function clearbit(domain) {
  return `https://logo.clearbit.com/${domain}`;
}

const STOCK_BROKERS = [
  { key: 'schwab', name: 'Charles Schwab', domain: 'schwab.com', country: 'US' },
  { key: 'fidelity', name: 'Fidelity Investments', domain: 'fidelity.com', country: 'US' },
  { key: 'vanguard', name: 'Vanguard Brokerage', domain: 'vanguard.com', country: 'US' },
  { key: 'tdameritrade', name: 'TD Ameritrade (Schwab)', domain: 'tdameritrade.com', country: 'US' },
  { key: 'etrade', name: 'E*TRADE', domain: 'etrade.com', country: 'US' },
  { key: 'merrilledge', name: 'Merrill Edge', domain: 'merrilledge.com', country: 'US' },
  { key: 'interactivebrokers', name: 'Interactive Brokers', domain: 'ibkr.com', country: 'US' },
  { key: 'webull', name: 'Webull', domain: 'webull.com', country: 'US' },
  { key: 'sofi', name: 'SoFi Invest', domain: 'sofi.com', country: 'US' },
  { key: 'ally', name: 'Ally Invest', domain: 'ally.com', country: 'US' },
  { key: 'm1', name: 'M1 Finance', domain: 'm1.com', country: 'US' },
  { key: 'public', name: 'Public', domain: 'public.com', country: 'US' },
  { key: 'stash', name: 'Stash', domain: 'stash.com', country: 'US' },
  // Europe
  { key: 'etoro', name: 'eToro', domain: 'etoro.com', country: 'EU' },
  { key: 'degiro', name: 'DEGIRO', domain: 'degiro.com', country: 'EU' },
  { key: 'trading212', name: 'Trading 212', domain: 'trading212.com', country: 'EU' },
  { key: 'saxobank', name: 'Saxo Bank', domain: 'saxobank.com', country: 'EU' },
  { key: 'ig', name: 'IG', domain: 'ig.com', country: 'EU' },
  { key: 'plus500', name: 'Plus500', domain: 'plus500.com', country: 'EU' },
  { key: 'traderepublic', name: 'Trade Republic', domain: 'traderepublic.com', country: 'EU' },
  { key: 'comdirect', name: 'Comdirect', domain: 'comdirect.de', country: 'EU' },
  { key: 'boursorama', name: 'Boursorama', domain: 'boursorama.com', country: 'EU' },
  // Canada
  { key: 'questrade', name: 'Questrade', domain: 'questrade.com', country: 'CA' },
  { key: 'wealthsimple', name: 'Wealthsimple Trade', domain: 'wealthsimple.com', country: 'CA' },
  // Australia
  { key: 'commsec', name: 'CommSec', domain: 'commsec.com.au', country: 'AU' },
  { key: 'cmcmarkets', name: 'CMC Markets', domain: 'cmcmarkets.com', country: 'AU' },
  { key: 'selfwealth', name: 'SelfWealth', domain: 'selfwealth.com.au', country: 'AU' },
  // UK
  { key: 'revolut', name: 'Revolut Trading', domain: 'revolut.com', country: 'UK' }
].map(b => ({ ...b, logo_url: clearbit(b.domain), category: 'stocks' }));

const CRYPTO_BROKERS = [
  { key: 'coinbase', name: 'Coinbase', domain: 'coinbase.com', country: 'US', oauth: true, login_path: '/signin' },
  { key: 'kraken', name: 'Kraken', domain: 'kraken.com', country: 'US', login_path: '/sign-in' },
  { key: 'crypto', name: 'Crypto.com Exchange', domain: 'crypto.com', country: 'US', login_path: '/exchange' },
  { key: 'binanceus', name: 'Binance.US', domain: 'binance.us', country: 'US', login_path: '/en/login' },
  { key: 'gemini', name: 'Gemini', domain: 'gemini.com', country: 'US', login_path: '/signin' },
  { key: 'bitstamp', name: 'Bitstamp', domain: 'bitstamp.net', country: 'EU', login_path: '/account/login' },
  { key: 'kucoin', name: 'KuCoin', domain: 'kucoin.com', country: 'SG', login_path: '/account/login' },
  { key: 'okx', name: 'OKX', domain: 'okx.com', country: 'SG', login_path: '/account/login' },
  { key: 'bybit', name: 'Bybit', domain: 'bybit.com', country: 'SG', login_path: '/login' },
  { key: 'bitfinex', name: 'Bitfinex', domain: 'bitfinex.com', country: 'EU', login_path: '/sign-in' },
  { key: 'htx', name: 'HTX (Huobi)', domain: 'htx.com', country: 'SG', login_path: '/login' }
].map(b => ({ ...b, logo_url: clearbit(b.domain), category: 'crypto' }));

const BROKERS = [...STOCK_BROKERS, ...CRYPTO_BROKERS];

function maskToken(token) {
  if (!token) return '';
  const vis = 4;
  return `${'*'.repeat(Math.max(0, token.length - vis))}${token.slice(-vis)}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, payload } = body || {};

    if (action === 'listBrokers') {
      const category = payload?.category || null; // 'stocks' | 'crypto' | null
      const list = category ? BROKERS.filter(b => b.category === category) : BROKERS;
      return Response.json({ brokers: list });
    }

    if (action === 'getAuthUrl' || action === 'initiateOAuth') {
      const { brokerKey } = payload || {};
      const broker = BROKERS.find(b => b.key === brokerKey);
      if (!broker) return Response.json({ error: 'Unknown broker' }, { status: 400 });

      // Provide real login URL (or OAuth URL if configured)
      let auth_url = `https://${broker.domain}${broker.login_path || ''}`;

      // Example for Coinbase OAuth flow (requires secrets). If unavailable, fallback to login page.
      if (broker.key === 'coinbase' && broker.oauth) {
        const cbClientId = Deno.env.get('COINBASE_CLIENT_ID');
        const cbRedirect = Deno.env.get('COINBASE_REDIRECT_URI');
        if (cbClientId && cbRedirect) {
          const scope = encodeURIComponent('wallet:accounts:read wallet:buys:create wallet:sells:create wallet:transactions:read');
          const redirectUri = encodeURIComponent(cbRedirect);
          auth_url = `https://www.coinbase.com/oauth/authorize?response_type=code&client_id=${cbClientId}&redirect_uri=${redirectUri}&scope=${scope}`;
        }
      }

      // Ensure we track a pending connection for this broker (no fake "connected")
      const existing = await base44.entities.BrokerConnection.filter({ created_by: user.email, broker_key: broker.key });
      if (existing && existing[0]) {
        await base44.entities.BrokerConnection.update(existing[0].id, {
          status: 'pending',
          connection_type: broker.oauth ? 'oauth' : 'redirect',
          last_synced_at: new Date().toISOString(),
          note: 'Awaiting authorization on broker site'
        });
      } else {
        await base44.entities.BrokerConnection.create({
          broker_key: broker.key,
          broker_name: broker.name,
          broker_domain: broker.domain,
          status: 'pending',
          connection_type: broker.oauth ? 'oauth' : 'redirect',
          scopes: [],
          last_synced_at: new Date().toISOString(),
          note: 'Awaiting authorization on broker site'
        });
      }

      return Response.json({ auth_url, state: crypto.randomUUID() });
    }

    if (action === 'completeOAuth') {
      // This endpoint should be called by a real OAuth callback handler after token exchange.
      // We no longer auto-connect without a verified token.
      const { brokerKey, token_mask } = payload || {};
      const broker = BROKERS.find(b => b.key === brokerKey);
      if (!broker) return Response.json({ error: 'Unknown broker' }, { status: 400 });

      const existing = await base44.entities.BrokerConnection.filter({ created_by: user.email, broker_key: broker.key });
      if (existing && existing[0]) {
        await base44.entities.BrokerConnection.update(existing[0].id, {
          status: token_mask ? 'connected' : 'pending',
          note: token_mask ? `Token: ${maskToken(token_mask)}` : 'Pending OAuth callback',
          last_synced_at: new Date().toISOString()
        });
        return Response.json({ success: !!token_mask, pending: !token_mask });
      }
      return Response.json({ error: 'No pending connection found' }, { status: 404 });
    }

    if (action === 'disconnect') {
      const { brokerKey } = payload || {};
      const existing = await base44.entities.BrokerConnection.filter({ created_by: user.email, broker_key: brokerKey });
      if (existing && existing[0]) {
        await base44.entities.BrokerConnection.update(existing[0].id, {
          status: 'disconnected',
          note: 'Disconnected by user'
        });
      }
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('brokerLink error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});