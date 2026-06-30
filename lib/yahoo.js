// Yahoo Finance client.
//
// Yahoo's public JSON endpoints are free and very rich, but two things make them
// awkward from a browser: CORS, and the fact that quoteSummary/options now require
// a "crumb" token paired with a session cookie. We handle the cookie+crumb dance
// here, server-side, and cache the credentials.
import { cached } from './cache.js';

const UA = 'Mozilla/5.0';
const FETCH_TIMEOUT = 15000; // abort a hung socket so it can't stall the throttle queue forever

let creds = { cookie: null, crumb: null, ts: 0 };
const CRED_TTL = 25 * 60 * 1000; // refresh every 25 min

// --- Request throttle -------------------------------------------------------
// Yahoo aggressively rate-limits bursts from a single IP. We funnel every
// outbound Yahoo call through a queue that runs them one at a time with a small
// gap, which avoids the 429s that a parallel fan-out would otherwise trigger.
const MIN_GAP_MS = 600;
let chain = Promise.resolve();
let lastRun = 0;

function throttle(task) {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastRun));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastRun = Date.now();
    return task();
  });
  // Keep the chain alive regardless of individual task outcome.
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function refreshCreds() {
  // Step 1: hit a Yahoo endpoint that hands back a session cookie.
  const seed = await throttle(() =>
    fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
  ).catch(() => null);

  let cookie = null;
  if (seed) {
    const setCookies =
      typeof seed.headers.getSetCookie === 'function'
        ? seed.headers.getSetCookie()
        : [seed.headers.get('set-cookie')].filter(Boolean);
    cookie = setCookies.map((c) => c.split(';')[0]).join('; ') || null;
  }

  // Step 2: trade the cookie for a crumb.
  const res = await throttle(() =>
    fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
  );
  const crumb = (await res.text()).trim();

  // A valid Yahoo crumb is short and whitespace-free. Error bodies like
  // "Too Many Requests" or HTML must not be cached as a crumb.
  const valid = crumb && crumb.length <= 24 && !/\s|<|>/.test(crumb);
  creds = { cookie, crumb: valid ? crumb : null, ts: Date.now() };
  return creds;
}

async function ensureCreds(force = false) {
  if (!force && creds.crumb && Date.now() - creds.ts < CRED_TTL) return creds;
  return refreshCreds();
}

// Authenticated GET against a Yahoo host, with crumb refresh on 401 and a
// single backoff retry on 429 (rate limit).
async function authGet(buildUrl) {
  await ensureCreds();
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = buildUrl(creds.crumb);
    const res = await throttle(() =>
      fetch(url, {
        headers: { 'User-Agent': UA, ...(creds.cookie ? { Cookie: creds.cookie } : {}) },
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      })
    );
    if (res.status === 401 || res.status === 403) {
      await ensureCreds(true);
      continue;
    }
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    if (!res.ok) throw new Error(`Yahoo ${res.status} for ${url}`);
    return res.json();
  }
  throw new Error('Yahoo authentication failed (crumb)');
}

// Plain GET (endpoints that do not need a crumb), with one 429 backoff retry.
async function get(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await throttle(() => fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT) }));
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    if (!res.ok) throw new Error(`Yahoo ${res.status} for ${url}`);
    return res.json();
  }
}

export function search(q) {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
    `&quotesCount=10&newsCount=8&enableFuzzyQuery=false`;
  return cached(`y:search:${q.toLowerCase()}`, 60 * 1000, () => get(url));
}

const SUMMARY_MODULES = [
  'assetProfile',
  'summaryProfile',
  'summaryDetail',
  'price',
  'defaultKeyStatistics',
  'financialData',
  'incomeStatementHistory',
  'incomeStatementHistoryQuarterly',
  'balanceSheetHistory',
  'balanceSheetHistoryQuarterly',
  'cashflowStatementHistory',
  'cashflowStatementHistoryQuarterly',
  'earnings',
  'earningsHistory',
  'earningsTrend',
  'calendarEvents',
  'recommendationTrend',
  'upgradeDowngradeHistory',
  'insiderTransactions',
  'insiderHolders',
  'institutionOwnership',
  'fundOwnership',
  'majorHoldersBreakdown',
  'netSharePurchaseActivity',
];

export function quoteSummary(symbol) {
  const mods = SUMMARY_MODULES.join(',');
  return cached(`y:summary:${symbol}`, 60 * 1000, () =>
    authGet(
      (crumb) =>
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
        `?modules=${mods}&crumb=${encodeURIComponent(crumb || '')}`
    )
  );
}

export function chart(symbol, range = '1y', interval = '1d') {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
  return cached(`y:chart:${symbol}:${range}:${interval}`, 60 * 1000, () => get(url));
}

// Benchmark price history (e.g. SPY/QQQ). Cached for hours — index bars barely move
// intraday and are reused across every analysis request, so this stays cheap.
export function benchmarkChart(symbol, range = '5y', interval = '1d') {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;
  return cached(`y:bench:${symbol}:${range}:${interval}`, 6 * 60 * 60 * 1000, () => get(url));
}

export function options(symbol) {
  return cached(`y:options:${symbol}`, 5 * 60 * 1000, () =>
    authGet(
      (crumb) =>
        `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}` +
        `?crumb=${encodeURIComponent(crumb || '')}`
    )
  );
}
