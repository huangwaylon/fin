// Aggregator — fans out to every data source in parallel and returns one blob.
// Uses allSettled so a single failing source never takes down the whole response.
import * as yahoo from './yahoo.js';
import * as sec from './sec.js';
import * as finnhub from './finnhub.js';
import { history as stooqHistory } from './stooq.js';

function settled(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: String(error?.message || error) })
  );
}

export async function research(symbol) {
  const sym = symbol.toUpperCase();

  const [summary, chart, options, filings, peers] = await Promise.all([
    settled(yahoo.quoteSummary(sym)),
    settled(yahoo.chart(sym, '1y', '1d')),
    settled(yahoo.options(sym)),
    settled(sec.recentFilings(sym)),
    settled(finnhub.peers(sym)),
  ]);

  // News rides along on Yahoo's search endpoint.
  const news = await settled(yahoo.search(sym));

  return {
    symbol: sym,
    fetchedAt: new Date().toISOString(),
    sources: {
      summary: summary.ok ? summary.value : null,
      chart: chart.ok ? chart.value : null,
      options: options.ok ? options.value : null,
      filings: filings.ok ? filings.value : null,
      peers: peers.ok ? peers.value : null,
      news: news.ok ? news.value : null,
    },
    errors: {
      summary: summary.ok ? null : summary.error,
      chart: chart.ok ? null : chart.error,
      options: options.ok ? null : options.error,
      filings: filings.ok ? null : filings.error,
      peers: peers.ok ? null : peers.error,
      news: news.ok ? null : news.error,
    },
    meta: { finnhubEnabled: finnhub.finnhubEnabled },
  };
}

// Lightweight snapshot for watchlist / compare rows.
export async function snapshot(symbol) {
  const sym = symbol.toUpperCase();
  try {
    const data = await yahoo.quoteSummary(sym);
    const r = data?.quoteSummary?.result?.[0] || {};
    const price = r.price || {};
    const detail = r.summaryDetail || {};
    const fin = r.financialData || {};
    const stats = r.defaultKeyStatistics || {};
    return {
      symbol: sym,
      name: price.shortName || price.longName || sym,
      price: price.regularMarketPrice?.raw ?? null,
      change: price.regularMarketChange?.raw ?? null,
      changePercent: price.regularMarketChangePercent?.raw ?? null,
      currency: price.currency || 'USD',
      marketCap: price.marketCap?.raw ?? null,
      pe: detail.trailingPE?.raw ?? null,
      forwardPe: stats.forwardPE?.raw ?? null,
      dividendYield: detail.dividendYield?.raw ?? null,
      beta: detail.beta?.raw ?? stats.beta?.raw ?? null,
      week52High: detail.fiftyTwoWeekHigh?.raw ?? null,
      week52Low: detail.fiftyTwoWeekLow?.raw ?? null,
      targetMean: fin.targetMeanPrice?.raw ?? null,
      recommendation: fin.recommendationKey || null,
      profitMargin: fin.profitMargins?.raw ?? null,
      revenueGrowth: fin.revenueGrowth?.raw ?? null,
    };
  } catch (e) {
    return { symbol: sym, error: String(e?.message || e) };
  }
}
