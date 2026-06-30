// News & research extraction.
//
// Two jobs:
//   1. Multi-source headline discovery (Google News RSS) to complement Yahoo's
//      per-ticker news.
//   2. Readable full-text extraction for a single article URL, so an analyst or
//      an LLM can pull the actual text into a thesis.
//
// Financial Times articles are gated. We apply the documented "Googlebot crawler"
// header strategy (the highest-priority rule from the local free-ft extension:
// User-Agent: Googlebot, Referer: google.com, consent cookie) to retrieve them.
// This mirrors the user's own extension and is intended for personal research use;
// respect each publisher's terms.
import { cached } from './cache.js';
import { assertPublicUrl } from './ssrf.js';

const BROWSER_UA = 'Mozilla/5.0';
const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function headersFor(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    /* ignore */
  }
  if (/(^|\.)ft\.com$/.test(host)) {
    // Strategy 1 — Googlebot crawler bypass (from free-ft rules.json).
    return {
      'User-Agent': GOOGLEBOT_UA,
      Referer: 'https://www.google.com',
      Cookie: 'FTCookieConsentGDPR=true',
    };
  }
  // Generic: look like a click-through from search.
  return { 'User-Agent': BROWSER_UA, Referer: 'https://www.google.com' };
}

// --- HTML helpers (dependency-free) ---
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, key) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

// Pull a NewsArticle/Article JSON-LD block (most quality publishers embed one
// with articleBody, headline, datePublished, author).
function jsonLdArticle(html) {
  const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data;
    try {
      data = JSON.parse(b[1].trim());
    } catch {
      continue;
    }
    const candidates = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
    for (const node of candidates) {
      const type = node && (Array.isArray(node['@type']) ? node['@type'].join(',') : node['@type']);
      if (type && /Article|Report|NewsArticle/i.test(type) && node.articleBody) {
        const author = node.author
          ? Array.isArray(node.author)
            ? node.author.map((a) => a.name).filter(Boolean).join(', ')
            : node.author.name
          : null;
        return {
          headline: node.headline || null,
          articleBody: node.articleBody,
          datePublished: node.datePublished || null,
          author: author || null,
        };
      }
    }
  }
  return null;
}

const MAX_TEXT = 14000;
const MAX_BYTES = 4 * 1024 * 1024; // cap downloaded article HTML at 4 MB

// Read a fetch response body with a hard byte budget so a huge/malicious page
// can't exhaust memory. Aborts the download once the cap is hit.
async function readCapped(res, maxBytes = MAX_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') return res.text();
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    chunks.push(value);
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

// Fetch following redirects MANUALLY, re-running the SSRF guard on every hop so a
// public URL can't redirect us into a private/loopback address (the classic
// redirect-based SSRF bypass). Returns the response and the final resolved URL.
async function safeFetch(url, headers, maxHops = 5) {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { headers, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (loc) {
      current = new URL(loc, current).href; // resolve relative redirects
      continue;
    }
    return { res, finalUrl: current };
  }
  throw httpError(400, 'Too many redirects');
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export async function extractArticle(url) {
  return cached(`article:${url}`, 30 * 60 * 1000, async () => {
    const { res, finalUrl } = await safeFetch(url, headersFor(url));
    const host = (() => {
      try {
        return new URL(finalUrl).hostname.replace(/^www\./, '');
      } catch {
        return null;
      }
    })();
    if (!res.ok) {
      return { url: finalUrl, source: host, ok: false, status: res.status, error: `Fetch failed (${res.status})` };
    }
    const html = await readCapped(res);

    const ld = jsonLdArticle(html);
    let text;
    let method;
    if (ld && ld.articleBody && ld.articleBody.length > 200) {
      text = ld.articleBody;
      method = 'json-ld';
    } else {
      // Fall back to paragraph text inside <article>, else whole document.
      const article = html.match(/<article[\s\S]*?<\/article>/i);
      text = stripTags(article ? article[0] : html);
      method = 'html';
    }
    const truncated = text.length > MAX_TEXT;
    return {
      url: finalUrl,
      source: host,
      ok: true,
      title: (ld && ld.headline) || metaContent(html, 'og:title') || (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null),
      author: ld?.author || metaContent(html, 'author') || null,
      publishedTime: ld?.datePublished || metaContent(html, 'article:published_time') || null,
      description: metaContent(html, 'og:description') || metaContent(html, 'description') || null,
      text: truncated ? text.slice(0, MAX_TEXT) + '…' : text,
      truncated,
      method,
      paywallBypass: /(^|\.)ft\.com$/.test(host || '') ? 'googlebot' : null,
    };
  });
}

// Google News RSS — broad multi-publisher headline discovery for a query.
export async function googleNews(query) {
  return cached(`gnews:${query.toLowerCase()}`, 10 * 60 * 1000, async () => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
    if (!res.ok) throw new Error(`Google News ${res.status}`);
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 20).map((m) => {
      const block = m[1];
      const tag = (t) => {
        const mm = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
        if (!mm) return null;
        return decodeEntities(mm[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim());
      };
      const title = tag('title');
      // Google wraps the publisher name in the title after " - "
      const publisher = tag('source') || (title && title.includes(' - ') ? title.split(' - ').pop() : null);
      return {
        title: title && title.includes(' - ') ? title.slice(0, title.lastIndexOf(' - ')) : title,
        link: tag('link'),
        publisher,
        published: tag('pubDate'),
        source: 'google-news',
      };
    });
    return items.filter((i) => i.title && i.link);
  });
}

// Merge Yahoo news (direct publisher links — best for extraction) with Google
// News discovery, de-duplicated by title.
export async function mergedNews(symbol, yahooNews = []) {
  const yahoo = (yahooNews || []).map((n) => ({
    title: n.title,
    link: n.link,
    publisher: n.publisher,
    published: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    source: 'yahoo',
  }));
  let google = [];
  try {
    google = await googleNews(symbol);
  } catch {
    /* google news optional */
  }
  const seen = new Set();
  const out = [];
  for (const item of [...yahoo, ...google]) {
    const key = (item.title || '').toLowerCase().slice(0, 60);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
