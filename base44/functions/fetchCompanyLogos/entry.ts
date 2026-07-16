import { createClientFromRequest } from 'npm:@base44/sdk@0.7.1';

function fetchWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('timeout'), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id));
}

// SSRF guard: only allow outbound requests to public https hosts. Blocks localhost,
// private/reserved IP ranges, cloud metadata endpoints, and non-https schemes.
function isSafePublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (_e) {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();

  // Block obvious internal hostnames and the cloud metadata service.
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === 'metadata' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return false;
  }

  // If the host is an IPv4 literal, reject private/reserved/loopback ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) || // link-local (incl. 169.254.169.254 metadata)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast / reserved
    ) {
      return false;
    }
  }

  // Reject IPv6 literals (brackets) — includes ::1 loopback and unique-local.
  if (host.includes(':')) return false;

  return true;
}

async function validateImageUrl(url, timeoutMs = 2000) {
  // SSRF: never fetch a URL that resolves to an internal/private/non-https target,
  // even if an upstream LLM was tricked into returning one via prompt injection.
  if (!isSafePublicUrl(url)) return false;
  // Try HEAD quickly
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow', cache: 'no-store' }, timeoutMs);
    if (head.ok) {
      const ct = (head.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('image')) return true;
    }
  } catch (_e) { void 0; }
  // Fallback to a quick GET
  try {
    const getResp = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow', cache: 'no-store' }, Math.max(1200, Math.floor(timeoutMs * 0.75)));
    if (getResp.ok) {
      const ct2 = (getResp.headers.get('content-type') || '').toLowerCase();
      return ct2.includes('image');
    }
  } catch (_e) { void 0; }
  return false;
}

function withTimeout(promise, ms, msg = 'timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ]);
}

async function readJsonSafe(req, ms = 1200) {
  try {
    const text = await withTimeout(req.text(), ms, 'body-timeout');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_e) {
      return {};
    }
  } catch (_e) {
    return {};
  }
}

function chunk(array, size) {
  const res = [];
  for (let i = 0; i < array.length; i += size) res.push(array.slice(i, i + size));
  return res;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fast, safe body parse with small timeout
    const body = await readJsonSafe(req, 1200);
    const rawSymbols = Array.isArray(body?.symbols) ? body.symbols : [];
    const symbols = Array.from(new Set(rawSymbols.map(s => String(s || '').toUpperCase()).filter(Boolean)));
    if (symbols.length === 0) {
      return Response.json({ logos: {}, domains: {}, names: {} });
    }

    // Require auth for usage (prevents abuse)
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const nowIso = new Date().toISOString();

    const processSymbol = async (sym) => {
      // 1) Try cache first (service role)
      let cachedItem = null;
      try {
        const cached = await withTimeout(
          base44.asServiceRole.entities.AssetCache.filter({ symbol: sym, asset_type: 'stocks' }, '-updated_date', 1),
          2000,
          'cache-timeout'
        );
        cachedItem = Array.isArray(cached) && cached.length ? cached[0] : null;
      } catch (_e) { void 0; }

      if (cachedItem?.icon_url) {
        const ok = await validateImageUrl(cachedItem.icon_url, 1500);
        if (ok) {
          return {
            symbol: sym,
            logo: cachedItem.icon_url,
            domain: cachedItem.domain || null,
            name: cachedItem.name || sym
          };
        }
      }

      // 2) LLM-assisted lookup (strict timeout)
      let foundDomain = null;
      let foundLogo = null;
      let foundName = null;

      try {
        const llm = await withTimeout(
          base44.integrations.Core.InvokeLLM({
            prompt: [
              `Find the official domain and a direct logo image (png or svg) for the stock ticker "${sym}".`,
              "Prefer the official site, Wikipedia/Wikimedia, or a reputable brand assets CDN.",
              "Return: domain (bare domain like example.com), logo_url (direct image), and company name."
            ].join('\n'),
            add_context_from_internet: true,
            response_json_schema: {
              type: 'object',
              properties: {
                domain: { type: 'string' },
                logo_url: { type: 'string' },
                name: { type: 'string' }
              }
            }
          }),
          6500,
          'llm-timeout'
        );

        if (llm) {
          if (typeof llm.domain === 'string' && llm.domain) {
            foundDomain = llm.domain.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
          }
          if (typeof llm.logo_url === 'string' && llm.logo_url) {
            const ok = await validateImageUrl(llm.logo_url, 1800);
            if (ok) foundLogo = llm.logo_url;
          }
          if (typeof llm.name === 'string' && llm.name) {
            foundName = llm.name;
          }
        }
      } catch (_e) { void 0; }

      // 3) Clearbit fallback if domain found but logo not validated
      if (!foundLogo && foundDomain) {
        const clearbit = `https://logo.clearbit.com/${foundDomain}`;
        const ok = await validateImageUrl(clearbit, 1500);
        if (ok) foundLogo = clearbit;
      }

      // 4) Update cache best-effort
      try {
        if (cachedItem) {
          await withTimeout(
            base44.asServiceRole.entities.AssetCache.update(cachedItem.id, {
              icon_url: foundLogo || cachedItem.icon_url || null,
              name: foundName || cachedItem.name || sym,
              domain: foundDomain || cachedItem.domain || null,
              last_verified: nowIso
            }),
            1500,
            'cache-update-timeout'
          );
        } else {
          await withTimeout(
            base44.asServiceRole.entities.AssetCache.create({
              symbol: sym,
              asset_type: 'stocks',
              name: foundName || sym,
              icon_url: foundLogo || null,
              domain: foundDomain || null,
              cached_at: nowIso,
              last_verified: nowIso
            }),
            1500,
            'cache-create-timeout'
          );
        }
      } catch (_e) { void 0; }

      return {
        symbol: sym,
        logo: foundLogo || null,
        domain: foundDomain || null,
        name: foundName || sym
      };
    };

    // Bounded concurrency to avoid long hangs: 4 at a time
    const batches = chunk(symbols, 4);
    const logos = {};
    const domains = {};
    const names = {};

    for (const group of batches) {
      const settled = await Promise.allSettled(group.map((s) => withTimeout(processSymbol(s), 9000, 'symbol-timeout')));
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value && r.value.symbol) {
          const { symbol, logo, domain, name } = r.value;
          if (logo) logos[symbol] = logo;
          if (domain) domains[symbol] = domain;
          if (name) names[symbol] = name;
        }
      }
    }

    // Always return quickly with what we have
    return Response.json({ logos, domains, names });
  } catch (error) {
    return Response.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
});