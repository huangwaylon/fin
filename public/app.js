// Stock Research Terminal — frontend application logic (vanilla JS).
'use strict';

/* ----------------------------- State ----------------------------- */
const state = {
  symbol: null,
  data: null, // last /api/research payload
  tab: 'overview',
  watchlist: loadWatchlist(),
  chart: { range: '1y', sma: true, ema: false, bb: false, indicator: 'rsi', bars: null },
};

const TABS = [
  ['overview', 'Overview'],
  ['chart', 'Chart'],
  ['fundamentals', 'Fundamentals'],
  ['analysts', 'Analysts'],
  ['earnings', 'Earnings'],
  ['ownership', 'Ownership'],
  ['options', 'Options'],
  ['news', 'News'],
  ['filings', 'Filings'],
  ['notes', 'Notes'],
];

/* ----------------------------- Utilities ----------------------------- */
const $ = (sel) => document.querySelector(sel);
const R = (x) => (x && typeof x === 'object' && 'raw' in x ? x.raw : x ?? null);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n, dp = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtPct(n, dp = 2) {
  if (n == null || isNaN(n)) return '—';
  return (n * 100).toFixed(dp) + '%';
}
function fmtBig(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(2) + 'K';
  return sign + a.toFixed(0);
}
function fmtDate(v) {
  if (v == null) return '—';
  let d;
  if (typeof v === 'number') d = new Date(v * 1000);
  else d = new Date(v);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function colorClass(n) {
  if (n == null || isNaN(n)) return '';
  return n > 0 ? 'up' : n < 0 ? 'down' : '';
}
function signed(n, fmt = fmtPrice) {
  if (n == null || isNaN(n)) return '—';
  return (n > 0 ? '+' : '') + fmt(n);
}

/* ----------------------------- API ----------------------------- */
async function api(path) {
  const res = await fetch(path);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

/* ----------------------------- Watchlist (localStorage) ----------------------------- */
function loadWatchlist() {
  try {
    return JSON.parse(localStorage.getItem('watchlist') || '[]');
  } catch {
    return [];
  }
}
function saveWatchlist() {
  localStorage.setItem('watchlist', JSON.stringify(state.watchlist));
}
function inWatchlist(sym) {
  return state.watchlist.includes(sym);
}
function toggleWatchlist(sym) {
  if (inWatchlist(sym)) state.watchlist = state.watchlist.filter((s) => s !== sym);
  else state.watchlist.push(sym);
  saveWatchlist();
  renderWatchlist();
}

async function renderWatchlist() {
  const el = $('#watchlist');
  if (!state.watchlist.length) {
    el.innerHTML = '<div class="wl-empty">No tickers yet.<br />Search and add some.</div>';
    return;
  }
  el.innerHTML = state.watchlist
    .map(
      (s) =>
        `<div class="wl-item ${s === state.symbol ? 'active' : ''}" data-sym="${s}">
          <span class="wl-sym">${esc(s)}</span>
          <span class="wl-right" data-px="${s}"><span class="wl-px">…</span></span>
          <span class="wl-remove" data-remove="${s}" title="Remove">✕</span>
        </div>`
    )
    .join('');

  // Fetch snapshots lazily
  state.watchlist.forEach(async (s) => {
    try {
      const snap = await api(`/api/snapshot?symbol=${encodeURIComponent(s)}`);
      const slot = el.querySelector(`[data-px="${s}"]`);
      if (!slot || snap.error) return;
      slot.innerHTML = `<span class="wl-px num">${fmtPrice(snap.price)}</span>
        <span class="wl-chg num ${colorClass(snap.changePercent)}">${signed(snap.changePercent, (n) => fmtPct(n))}</span>`;
    } catch {
      /* ignore */
    }
  });
}

/* ----------------------------- Search ----------------------------- */
let searchTimer = null;
function initSearch() {
  const input = $('#search');
  const box = $('#search-results');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 1) {
      box.hidden = true;
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
        const quotes = (data.quotes || []).filter((x) => x.symbol);
        if (!quotes.length) {
          box.hidden = true;
          return;
        }
        box.innerHTML = quotes
          .map(
            (x) =>
              `<div class="res" data-sym="${esc(x.symbol)}">
                <span class="sym">${esc(x.symbol)}</span>
                <span class="nm">${esc(x.shortname || x.longname || '')}</span>
                <span class="ex">${esc(x.exchDisp || x.typeDisp || '')}</span>
              </div>`
          )
          .join('');
        box.hidden = false;
      } catch {
        box.hidden = true;
      }
    }, 220);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = box.querySelector('.res');
      const sym = first ? first.dataset.sym : input.value.trim().toUpperCase();
      if (sym) selectTicker(sym);
    } else if (e.key === 'Escape') {
      box.hidden = true;
    }
  });

  box.addEventListener('click', (e) => {
    const res = e.target.closest('.res');
    if (res) selectTicker(res.dataset.sym);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) box.hidden = true;
  });
}

function selectTicker(sym) {
  $('#search').value = '';
  $('#search-results').hidden = true;
  loadTicker(sym);
}

/* ----------------------------- Load ticker ----------------------------- */
async function loadTicker(sym) {
  sym = sym.toUpperCase();
  state.symbol = sym;
  state.chart.bars = null;
  showView('dossier');
  $('#loading').hidden = false;
  renderWatchlist();
  try {
    state.data = await api(`/api/research?symbol=${encodeURIComponent(sym)}`);
    renderHeader();
    renderTabs();
    state.tab = 'overview';
    renderTab();
    location.hash = sym;
  } catch (e) {
    $('#tab-content').innerHTML = `<div class="error-note">Could not load ${esc(sym)}: ${esc(e.message)}</div>`;
  } finally {
    $('#loading').hidden = true;
  }
}

function result() {
  return state.data?.sources?.summary?.quoteSummary?.result?.[0] || {};
}

/* ----------------------------- Header ----------------------------- */
function renderHeader() {
  const r = result();
  const price = r.price || {};
  const detail = r.summaryDetail || {};
  const stats = r.defaultKeyStatistics || {};
  const fin = r.financialData || {};

  const px = R(price.regularMarketPrice);
  const chg = R(price.regularMarketChange);
  const chgPct = R(price.regularMarketChangePercent);
  const cur = price.currency || 'USD';
  const exch = price.exchangeName || price.exchange || '';
  const inWl = inWatchlist(state.symbol);

  const stat = (k, v) => `<div class="th-stat"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  $('#ticker-header').innerHTML = `
    <div class="th-top">
      <span class="th-sym">${esc(state.symbol)}</span>
      <span class="th-name">${esc(price.longName || price.shortName || '')}</span>
      ${exch ? `<span class="th-badge">${esc(exch)}</span>` : ''}
      <span class="th-badge">${esc(cur)}</span>
      <button class="th-badge" id="hdr-watch" style="cursor:pointer;color:${inWl ? 'var(--accent)' : 'var(--text-dim)'}">
        ${inWl ? '★ In watchlist' : '☆ Add to watchlist'}
      </button>
    </div>
    <div class="th-price-row">
      <span class="th-price num">${fmtPrice(px)}</span>
      <span class="th-change num ${colorClass(chg)}">${signed(chg)} (${signed(chgPct, (n) => fmtPct(n))})</span>
    </div>
    <div class="th-stats">
      ${stat('Mkt Cap', fmtBig(R(price.marketCap)))}
      ${stat('P/E (TTM)', fmtPrice(R(detail.trailingPE)))}
      ${stat('Fwd P/E', fmtPrice(R(stats.forwardPE)))}
      ${stat('EPS (TTM)', fmtPrice(R(stats.trailingEps)))}
      ${stat('Div Yield', fmtPct(R(detail.dividendYield)))}
      ${stat('Beta', fmtPrice(R(detail.beta ?? stats.beta)))}
      ${stat('52W Range', `${fmtPrice(R(detail.fiftyTwoWeekLow))} – ${fmtPrice(R(detail.fiftyTwoWeekHigh))}`)}
      ${stat('Volume', fmtBig(R(price.regularMarketVolume)))}
      ${stat('Target', fmtPrice(R(fin.targetMeanPrice)))}
    </div>`;

  $('#hdr-watch').addEventListener('click', () => {
    toggleWatchlist(state.symbol);
    renderHeader();
  });
}

/* ----------------------------- Tabs ----------------------------- */
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(
    ([id, label]) => `<button data-tab="${id}" class="${id === state.tab ? 'active' : ''}">${label}</button>`
  ).join('');
  $('#tabs').querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      $('#tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      renderTab();
    })
  );
}

function renderTab() {
  const fn = {
    overview: renderOverview,
    chart: renderChartTab,
    fundamentals: renderFundamentals,
    analysts: renderAnalysts,
    earnings: renderEarnings,
    ownership: renderOwnership,
    options: renderOptions,
    news: renderNews,
    filings: renderFilings,
    notes: renderNotes,
  }[state.tab];
  $('#tab-content').innerHTML = '';
  fn();
}

function card(title, bodyHtml) {
  return `<div class="card"><h3>${title}</h3><div class="card-body">${bodyHtml}</div></div>`;
}
function kvRows(pairs) {
  return pairs
    .map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v ${typeof v === 'object' ? v.cls || '' : ''}">${typeof v === 'object' ? v.text : v}</span></div>`)
    .join('');
}

/* ----------------------------- Overview ----------------------------- */
function renderOverview() {
  const r = result();
  const profile = r.assetProfile || r.summaryProfile || {};
  const detail = r.summaryDetail || {};
  const fin = r.financialData || {};
  const stats = r.defaultKeyStatistics || {};

  const valuation = card(
    'Valuation',
    kvRows([
      ['Market Cap', fmtBig(R(r.price?.marketCap))],
      ['Enterprise Value', fmtBig(R(stats.enterpriseValue))],
      ['Trailing P/E', fmtPrice(R(detail.trailingPE))],
      ['Forward P/E', fmtPrice(R(stats.forwardPE))],
      ['PEG Ratio', fmtPrice(R(stats.pegRatio))],
      ['Price/Sales', fmtPrice(R(stats.priceToSalesTrailing12Months ?? detail.priceToSalesTrailing12Months))],
      ['Price/Book', fmtPrice(R(stats.priceToBook))],
      ['EV/Revenue', fmtPrice(R(stats.enterpriseToRevenue))],
      ['EV/EBITDA', fmtPrice(R(stats.enterpriseToEbitda))],
    ])
  );

  const profitability = card(
    'Profitability & Returns',
    kvRows([
      ['Profit Margin', fmtPct(R(fin.profitMargins))],
      ['Operating Margin', fmtPct(R(fin.operatingMargins))],
      ['Gross Margin', fmtPct(R(fin.grossMargins))],
      ['Return on Equity', fmtPct(R(fin.returnOnEquity))],
      ['Return on Assets', fmtPct(R(fin.returnOnAssets))],
      ['Revenue Growth (YoY)', { text: fmtPct(R(fin.revenueGrowth)), cls: colorClass(R(fin.revenueGrowth)) }],
      ['Earnings Growth (YoY)', { text: fmtPct(R(fin.earningsGrowth)), cls: colorClass(R(fin.earningsGrowth)) }],
    ])
  );

  const health = card(
    'Financial Health',
    kvRows([
      ['Total Cash', fmtBig(R(fin.totalCash))],
      ['Total Debt', fmtBig(R(fin.totalDebt))],
      ['Debt/Equity', fmtPrice(R(fin.debtToEquity))],
      ['Current Ratio', fmtPrice(R(fin.currentRatio))],
      ['Quick Ratio', fmtPrice(R(fin.quickRatio))],
      ['Free Cash Flow', fmtBig(R(fin.freeCashflow))],
      ['Operating Cash Flow', fmtBig(R(fin.operatingCashflow))],
    ])
  );

  const dividend = card(
    'Dividend & Splits',
    kvRows([
      ['Dividend Rate', fmtPrice(R(detail.dividendRate))],
      ['Dividend Yield', fmtPct(R(detail.dividendYield))],
      ['Payout Ratio', fmtPct(R(detail.payoutRatio))],
      ['Ex-Dividend Date', fmtDate(R(detail.exDividendDate))],
      ['5Y Avg Yield', R(detail.fiveYearAvgDividendYield) != null ? R(detail.fiveYearAvgDividendYield) + '%' : '—'],
    ])
  );

  const facts = [];
  if (profile.sector) facts.push(['Sector', esc(profile.sector)]);
  if (profile.industry) facts.push(['Industry', esc(profile.industry)]);
  if (profile.fullTimeEmployees) facts.push(['Employees', fmtNum(profile.fullTimeEmployees)]);
  if (profile.country) facts.push(['HQ', esc([profile.city, profile.country].filter(Boolean).join(', '))]);
  if (profile.website)
    facts.push(['Website', `<a class="link" href="${esc(profile.website)}" target="_blank" rel="noopener">${esc(profile.website.replace(/^https?:\/\//, ''))}</a>`]);

  const company = card(
    'Company',
    `${facts.length ? kvRows(facts) : ''}
     ${profile.longBusinessSummary ? `<p class="prose" style="margin-top:12px">${esc(profile.longBusinessSummary)}</p>` : '<div class="empty">No description.</div>'}`
  );

  $('#tab-content').innerHTML =
    sourceErrors() +
    `<div class="grid cols-3">${valuation}${profitability}${health}</div>
     <div class="grid cols-2" style="margin-top:16px">${dividend}${recoCard()}</div>
     <div style="margin-top:16px">${company}</div>`;
  wireReco();
}

function recoCard() {
  const r = result();
  const fin = r.financialData || {};
  const key = fin.recommendationKey;
  if (!key || key === 'none')
    return card('Analyst Recommendation', '<div class="empty">No analyst coverage.</div>');
  const colors = { strong_buy: '#1f9d6b', buy: '#2ebd85', hold: '#e8b339', sell: '#f0616d', strong_sell: '#d4434f' };
  const mean = R(fin.recommendationMean);
  const n = R(fin.numberOfAnalystOpinions);
  return card(
    'Analyst Recommendation',
    `<div class="reco">
      <span class="reco-badge" style="background:${colors[key] || '#888'}22;color:${colors[key] || '#aaa'}">${esc(key.replace('_', ' '))}</span>
      <div style="flex:1">
        <div class="num" style="font-size:13px;color:var(--text-dim)">Mean rating ${fmtPrice(mean)} · ${n ?? '—'} analysts</div>
      </div>
    </div>
    ${kvRows([
      ['Target Mean', fmtPrice(R(fin.targetMeanPrice))],
      ['Target High', fmtPrice(R(fin.targetHighPrice))],
      ['Target Low', fmtPrice(R(fin.targetLowPrice))],
    ])}`
  );
}
function wireReco() {}

function sourceErrors() {
  const errs = state.data?.errors || {};
  const failed = Object.entries(errs).filter(([, v]) => v);
  if (!failed.length) return '';
  // Only surface if the primary summary source failed; minor source failures are silent.
  if (!errs.summary) return '';
  return `<div class="error-note">Some data unavailable: ${failed.map(([k]) => esc(k)).join(', ')}.</div>`;
}

/* ----------------------------- Chart ----------------------------- */
const RANGES = [
  ['1mo', '1M', '1d'],
  ['3mo', '3M', '1d'],
  ['6mo', '6M', '1d'],
  ['1y', '1Y', '1d'],
  ['2y', '2Y', '1d'],
  ['5y', '5Y', '1wk'],
  ['max', 'MAX', '1mo'],
];

function renderChartTab() {
  const c = state.chart;
  const seg = (id, label, active) => `<button data-range="${id}" class="${active ? 'active' : ''}">${label}</button>`;
  $('#tab-content').innerHTML = `
    <div class="chart-toolbar">
      <div class="seg">${RANGES.map(([id, label]) => seg(id, label, id === c.range)).join('')}</div>
      <div class="toggles">
        <label><input type="checkbox" id="t-sma" ${c.sma ? 'checked' : ''}/> SMA 50</label>
        <label><input type="checkbox" id="t-ema" ${c.ema ? 'checked' : ''}/> EMA 20</label>
        <label><input type="checkbox" id="t-bb" ${c.bb ? 'checked' : ''}/> Bollinger</label>
      </div>
      <div class="seg" style="margin-left:auto">
        ${['none', 'rsi', 'macd'].map((i) => `<button data-ind="${i}" class="${c.indicator === i ? 'active' : ''}">${i === 'none' ? 'No osc.' : i.toUpperCase()}</button>`).join('')}
      </div>
    </div>
    <div id="price-chart"></div>
    <div id="indicator-chart"></div>`;

  $('#tab-content')
    .querySelectorAll('[data-range]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        c.range = b.dataset.range;
        c.bars = null;
        renderChartTab();
      })
    );
  $('#tab-content')
    .querySelectorAll('[data-ind]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        c.indicator = b.dataset.ind;
        renderChartTab();
      })
    );
  ['sma', 'ema', 'bb'].forEach((k) => {
    $(`#t-${k}`).addEventListener('change', (e) => {
      c[k] = e.target.checked;
      drawChart();
    });
  });

  loadAndDraw();
}

async function loadAndDraw() {
  const c = state.chart;
  if (c.bars) return drawChart();
  const range = c.range;
  const interval = (RANGES.find((r) => r[0] === range) || [])[2] || '1d';
  try {
    const data = await api(`/api/history?symbol=${encodeURIComponent(state.symbol)}&range=${range}&interval=${interval}`);
    c.bars = parseHistory(data);
    drawChart();
  } catch (e) {
    $('#price-chart').innerHTML = `<div class="empty">Chart unavailable: ${esc(e.message)}</div>`;
  }
}

function parseHistory(data) {
  // Yahoo chart shape
  const res = data?.chart?.result?.[0];
  if (res && res.timestamp) {
    const q = res.indicators.quote[0];
    return res.timestamp
      .map((t, i) => ({
        time: t,
        open: q.open[i],
        high: q.high[i],
        low: q.low[i],
        close: q.close[i],
        volume: q.volume[i],
      }))
      .filter((b) => b.close != null);
  }
  // Stooq fallback shape
  if (data && data.bars) {
    return data.bars.map((b) => ({ time: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }));
  }
  return [];
}

function drawChart() {
  const c = state.chart;
  if (!c.bars || !c.bars.length) {
    $('#price-chart').innerHTML = '<div class="empty">No price data.</div>';
    return;
  }
  window.StockChart.render(c.bars, { sma: c.sma, ema: c.ema, bb: c.bb, indicator: c.indicator });
}

/* ----------------------------- Fundamentals ----------------------------- */
let fundFreq = 'annual';
function renderFundamentals() {
  const html = `
    <div class="chart-toolbar">
      <div class="seg">
        <button data-freq="annual" class="${fundFreq === 'annual' ? 'active' : ''}">Annual</button>
        <button data-freq="quarterly" class="${fundFreq === 'quarterly' ? 'active' : ''}">Quarterly</button>
      </div>
    </div>
    ${statementTable('Income Statement', incomeRows(), incomeFields)}
    <div style="height:16px"></div>
    ${statementTable('Balance Sheet', balanceRows(), balanceFields)}
    <div style="height:16px"></div>
    ${statementTable('Cash Flow', cashflowRows(), cashflowFields)}`;
  $('#tab-content').innerHTML = html;
  $('#tab-content')
    .querySelectorAll('[data-freq]')
    .forEach((b) =>
      b.addEventListener('click', () => {
        fundFreq = b.dataset.freq;
        renderFundamentals();
      })
    );
}

const incomeFields = [
  ['totalRevenue', 'Total Revenue'],
  ['costOfRevenue', 'Cost of Revenue'],
  ['grossProfit', 'Gross Profit'],
  ['researchDevelopment', 'R&D'],
  ['sellingGeneralAdministrative', 'SG&A'],
  ['operatingIncome', 'Operating Income'],
  ['ebit', 'EBIT'],
  ['interestExpense', 'Interest Expense'],
  ['incomeBeforeTax', 'Pretax Income'],
  ['incomeTaxExpense', 'Income Tax'],
  ['netIncome', 'Net Income'],
];
const balanceFields = [
  ['cash', 'Cash & Equivalents'],
  ['shortTermInvestments', 'Short-Term Investments'],
  ['netReceivables', 'Receivables'],
  ['inventory', 'Inventory'],
  ['totalCurrentAssets', 'Total Current Assets'],
  ['propertyPlantEquipment', 'PP&E'],
  ['goodWill', 'Goodwill'],
  ['totalAssets', 'Total Assets'],
  ['accountsPayable', 'Accounts Payable'],
  ['totalCurrentLiabilities', 'Total Current Liabilities'],
  ['longTermDebt', 'Long-Term Debt'],
  ['totalLiab', 'Total Liabilities'],
  ['totalStockholderEquity', 'Total Equity'],
  ['retainedEarnings', 'Retained Earnings'],
];
const cashflowFields = [
  ['netIncome', 'Net Income'],
  ['depreciation', 'Depreciation'],
  ['totalCashFromOperatingActivities', 'Operating Cash Flow'],
  ['capitalExpenditures', 'CapEx'],
  ['totalCashflowsFromInvestingActivities', 'Investing Cash Flow'],
  ['dividendsPaid', 'Dividends Paid'],
  ['repurchaseOfStock', 'Stock Buybacks'],
  ['totalCashFromFinancingActivities', 'Financing Cash Flow'],
  ['changeInCash', 'Net Change in Cash'],
];

function incomeRows() {
  const r = result();
  return fundFreq === 'annual'
    ? r.incomeStatementHistory?.incomeStatementHistory
    : r.incomeStatementHistoryQuarterly?.incomeStatementHistory;
}
function balanceRows() {
  const r = result();
  return fundFreq === 'annual'
    ? r.balanceSheetHistory?.balanceSheetStatements
    : r.balanceSheetHistoryQuarterly?.balanceSheetStatements;
}
function cashflowRows() {
  const r = result();
  return fundFreq === 'annual'
    ? r.cashflowStatementHistory?.cashflowStatements
    : r.cashflowStatementHistoryQuarterly?.cashflowStatements;
}

function statementTable(title, periods, fields) {
  if (!periods || !periods.length)
    return card(title, '<div class="empty">Not available.</div>');
  const head =
    `<th>${esc(title)}</th>` + periods.map((p) => `<th>${fmtDate(R(p.endDate))}</th>`).join('');
  const body = fields
    .map(([key, label]) => {
      const cells = periods
        .map((p) => {
          const v = R(p[key]);
          return `<td class="num ${colorClass(v)}">${v == null ? '—' : fmtBig(v)}</td>`;
        })
        .join('');
      return `<tr><td>${label}</td>${cells}</tr>`;
    })
    .join('');
  return `<div class="card"><h3>${esc(title)} <span style="color:var(--muted);font-weight:400">(USD)</span></h3>
    <div class="table-scroll"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

/* ----------------------------- Analysts ----------------------------- */
function renderAnalysts() {
  const r = result();
  const fin = r.financialData || {};
  const trend = r.recommendationTrend?.trend || [];
  const upgrades = r.upgradeDowngradeHistory?.history || [];
  const eTrend = r.earningsTrend?.trend || [];

  const targets = card(
    'Price Targets',
    kvRows([
      ['Current', fmtPrice(R(r.price?.regularMarketPrice))],
      ['Mean Target', fmtPrice(R(fin.targetMeanPrice))],
      ['Median Target', fmtPrice(R(fin.targetMedianPrice))],
      ['High Target', fmtPrice(R(fin.targetHighPrice))],
      ['Low Target', fmtPrice(R(fin.targetLowPrice))],
      ['# Analysts', R(fin.numberOfAnalystOpinions) ?? '—'],
    ])
  );

  let trendCard;
  if (trend.length) {
    const head = '<th>Period</th><th>Str. Buy</th><th>Buy</th><th>Hold</th><th>Sell</th><th>Str. Sell</th>';
    const body = trend
      .map(
        (t) =>
          `<tr><td>${esc(t.period)}</td><td class="num up">${t.strongBuy}</td><td class="num up">${t.buy}</td><td class="num">${t.hold}</td><td class="num down">${t.sell}</td><td class="num down">${t.strongSell}</td></tr>`
      )
      .join('');
    trendCard = `<div class="card"><h3>Recommendation Trend</h3><div class="table-scroll"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  } else {
    trendCard = card('Recommendation Trend', '<div class="empty">Not available.</div>');
  }

  let estCard;
  if (eTrend.length) {
    const rows = eTrend
      .filter((t) => ['0q', '+1q', '0y', '+1y'].includes(t.period))
      .map((t) => {
        const label = { '0q': 'Current Qtr', '+1q': 'Next Qtr', '0y': 'Current Year', '+1y': 'Next Year' }[t.period];
        return `<tr><td>${label}</td>
          <td class="num">${fmtPrice(R(t.earningsEstimate?.avg))}</td>
          <td class="num">${fmtBig(R(t.revenueEstimate?.avg))}</td>
          <td class="num ${colorClass(R(t.growth))}">${fmtPct(R(t.growth))}</td></tr>`;
      })
      .join('');
    estCard = `<div class="card"><h3>Estimates</h3><div class="table-scroll"><table class="data"><thead><tr><th>Period</th><th>EPS Est.</th><th>Rev Est.</th><th>Growth</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    estCard = card('Estimates', '<div class="empty">Not available.</div>');
  }

  let upgradeCard;
  if (upgrades.length) {
    const rows = upgrades
      .slice(0, 25)
      .map(
        (u) =>
          `<tr><td>${fmtDate(u.epochGradeDate)}</td><td style="text-align:left">${esc(u.firm)}</td>
           <td>${esc(u.toGrade || '')}</td><td style="color:var(--muted)">${esc(u.fromGrade || '')}</td>
           <td><span class="${u.action === 'up' ? 'up' : u.action === 'down' ? 'down' : ''}">${esc(u.action || '')}</span></td></tr>`
      )
      .join('');
    upgradeCard = `<div class="card"><h3>Upgrades / Downgrades</h3><div class="table-scroll"><table class="data"><thead><tr><th>Date</th><th style="text-align:left">Firm</th><th>To</th><th>From</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    upgradeCard = card('Upgrades / Downgrades', '<div class="empty">Not available.</div>');
  }

  $('#tab-content').innerHTML = `
    <div class="grid cols-2">${targets}${estCard}</div>
    <div style="margin-top:16px">${trendCard}</div>
    <div style="margin-top:16px">${upgradeCard}</div>`;
}

/* ----------------------------- Earnings ----------------------------- */
function renderEarnings() {
  const r = result();
  const earnings = r.earnings || {};
  const history = r.earningsHistory?.history || [];
  const cal = r.calendarEvents?.earnings || {};

  const nextDates = (cal.earningsDate || []).map((d) => fmtDate(R(d))).join(' – ');
  const calCard = card(
    'Upcoming Earnings',
    kvRows([
      ['Next Earnings Date', nextDates || '—'],
      ['EPS Estimate', fmtPrice(R(cal.earningsAverage))],
      ['EPS Low / High', `${fmtPrice(R(cal.earningsLow))} / ${fmtPrice(R(cal.earningsHigh))}`],
      ['Revenue Estimate', fmtBig(R(cal.revenueAverage))],
    ])
  );

  let histCard;
  if (history.length) {
    const rows = history
      .map(
        (h) =>
          `<tr><td>${esc(h.quarter?.fmt || fmtDate(R(h.quarter)))}</td>
           <td class="num">${fmtPrice(R(h.epsActual))}</td>
           <td class="num">${fmtPrice(R(h.epsEstimate))}</td>
           <td class="num ${colorClass(R(h.epsDifference))}">${signed(R(h.epsDifference))}</td>
           <td class="num ${colorClass(R(h.surprisePercent))}">${R(h.surprisePercent) != null ? signed(R(h.surprisePercent) * 100, (n) => n.toFixed(1) + '%') : '—'}</td></tr>`
      )
      .join('');
    histCard = `<div class="card"><h3>Earnings History (EPS)</h3><div class="table-scroll"><table class="data"><thead><tr><th>Quarter</th><th>Actual</th><th>Estimate</th><th>Surprise</th><th>Surprise %</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    histCard = card('Earnings History', '<div class="empty">Not available.</div>');
  }

  // Yearly revenue/earnings bars (financialsChart)
  let finChart = '';
  const yearly = earnings.financialsChart?.yearly || [];
  if (yearly.length) {
    const rows = yearly
      .map(
        (y) =>
          `<tr><td>${esc(y.date)}</td><td class="num">${fmtBig(R(y.revenue))}</td><td class="num">${fmtBig(R(y.earnings))}</td></tr>`
      )
      .join('');
    finChart = `<div class="card"><h3>Annual Revenue & Earnings</h3><div class="table-scroll"><table class="data"><thead><tr><th>Year</th><th>Revenue</th><th>Earnings</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  $('#tab-content').innerHTML = `
    <div class="grid cols-2">${calCard}${finChart || card('Annual Revenue & Earnings', '<div class="empty">Not available.</div>')}</div>
    <div style="margin-top:16px">${histCard}</div>`;
}

/* ----------------------------- Ownership ----------------------------- */
function renderOwnership() {
  const r = result();
  const breakdown = r.majorHoldersBreakdown || {};
  const inst = r.institutionOwnership?.ownershipList || [];
  const insiders = r.insiderHolders?.holders || [];
  const txns = r.insiderTransactions?.transactions || [];
  const net = r.netSharePurchaseActivity || {};

  const breakdownCard = card(
    'Ownership Breakdown',
    kvRows([
      ['% Held by Insiders', fmtPct(R(breakdown.insidersPercentHeld))],
      ['% Held by Institutions', fmtPct(R(breakdown.institutionsPercentHeld))],
      ['% Float Held by Inst.', fmtPct(R(breakdown.institutionsFloatPercentHeld))],
      ['# of Institutions', fmtNum(R(breakdown.institutionsCount))],
    ])
  );

  const netCard = card(
    'Insider Net Activity (6mo)',
    kvRows([
      ['Net Shares', fmtBig(R(net.netInfoShares ?? net.buyInfoShares))],
      ['Buy Transactions', fmtNum(R(net.buyInfoCount))],
      ['Sell Transactions', fmtNum(R(net.sellInfoCount))],
      ['% Net Change', fmtPct(R(net.netPercentInsiderShares))],
    ])
  );

  let instCard;
  if (inst.length) {
    const rows = inst
      .map(
        (o) =>
          `<tr><td style="text-align:left">${esc(o.organization)}</td>
           <td class="num">${fmtBig(R(o.position))}</td>
           <td class="num">${fmtBig(R(o.value))}</td>
           <td class="num">${fmtPct(R(o.pctHeld))}</td>
           <td>${fmtDate(R(o.reportDate))}</td></tr>`
      )
      .join('');
    instCard = `<div class="card"><h3>Top Institutional Holders</h3><div class="table-scroll"><table class="data"><thead><tr><th style="text-align:left">Holder</th><th>Shares</th><th>Value</th><th>% Held</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    instCard = card('Top Institutional Holders', '<div class="empty">Not available.</div>');
  }

  let txnCard;
  if (txns.length) {
    const rows = txns
      .slice(0, 30)
      .map(
        (t) =>
          `<tr><td style="text-align:left">${esc(t.filerName)}</td>
           <td style="text-align:left;color:var(--text-dim)">${esc(t.transactionText || t.filerRelation || '')}</td>
           <td class="num">${fmtBig(R(t.shares))}</td>
           <td class="num">${R(t.value) ? fmtBig(R(t.value)) : '—'}</td>
           <td>${fmtDate(R(t.startDate))}</td></tr>`
      )
      .join('');
    txnCard = `<div class="card"><h3>Recent Insider Transactions</h3><div class="table-scroll"><table class="data"><thead><tr><th style="text-align:left">Insider</th><th style="text-align:left">Transaction</th><th>Shares</th><th>Value</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  } else {
    txnCard = card('Recent Insider Transactions', '<div class="empty">Not available.</div>');
  }

  $('#tab-content').innerHTML = `
    <div class="grid cols-2">${breakdownCard}${netCard}</div>
    <div style="margin-top:16px">${instCard}</div>
    <div style="margin-top:16px">${txnCard}</div>`;
}

/* ----------------------------- Options ----------------------------- */
function renderOptions() {
  const chain = state.data?.sources?.options?.optionChain?.result?.[0];
  if (!chain || !chain.options || !chain.options.length) {
    $('#tab-content').innerHTML = card('Options', '<div class="empty">Options data not available for this security.</div>');
    return;
  }
  const opt = chain.options[0];
  const exp = fmtDate(opt.expirationDate);
  const otherExps = (chain.expirationDates || []).slice(0, 8).map((d) => fmtDate(d)).join(' · ');

  const optTable = (rows, label) => {
    if (!rows || !rows.length) return card(label, '<div class="empty">None.</div>');
    const body = rows
      .map(
        (o) =>
          `<tr class="${o.inTheMoney ? '' : ''}"><td class="num" style="text-align:left;color:${o.inTheMoney ? 'var(--accent)' : 'inherit'}">${fmtPrice(o.strike)}</td>
           <td class="num">${fmtPrice(o.lastPrice)}</td>
           <td class="num">${fmtPrice(o.bid)}</td>
           <td class="num">${fmtPrice(o.ask)}</td>
           <td class="num">${fmtNum(o.volume)}</td>
           <td class="num">${fmtNum(o.openInterest)}</td>
           <td class="num">${o.impliedVolatility != null ? (o.impliedVolatility * 100).toFixed(1) + '%' : '—'}</td></tr>`
      )
      .join('');
    return `<div class="card"><h3>${label}</h3><div class="table-scroll"><table class="data"><thead><tr><th style="text-align:left">Strike</th><th>Last</th><th>Bid</th><th>Ask</th><th>Vol</th><th>OI</th><th>IV</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
  };

  $('#tab-content').innerHTML = `
    <p class="prose" style="margin-bottom:14px">Nearest expiration: <strong>${exp}</strong>. Available: ${otherExps}</p>
    <div class="grid cols-2">${optTable(opt.calls, 'Calls')}${optTable(opt.puts, 'Puts')}</div>`;
}

/* ----------------------------- News ----------------------------- */
function renderNews() {
  const news = state.data?.sources?.news?.news || [];
  if (!news.length) {
    $('#tab-content').innerHTML = card('News', '<div class="empty">No recent news.</div>');
    return;
  }
  const items = news
    .map(
      (n) =>
        `<a class="news-item" href="${esc(n.link)}" target="_blank" rel="noopener">
          <div class="nh">${esc(n.title)}</div>
          <div class="nm">${esc(n.publisher || '')} · ${fmtDate(n.providerPublishTime)}${n.relatedTickers?.length ? ' · ' + esc(n.relatedTickers.join(', ')) : ''}</div>
        </a>`
    )
    .join('');
  $('#tab-content').innerHTML = `<div class="card"><h3>Recent News</h3>${items}</div>`;
}

/* ----------------------------- Filings ----------------------------- */
function renderFilings() {
  const f = state.data?.sources?.filings;
  if (!f || !f.found || !f.filings?.length) {
    $('#tab-content').innerHTML = card('SEC Filings', '<div class="empty">No SEC filings found (non-US listing or no EDGAR match).</div>');
    return;
  }
  const items = f.filings
    .map(
      (x) =>
        `<a class="filing-item" href="${esc(x.url || '#')}" target="_blank" rel="noopener">
          <span class="form">${esc(x.form)}</span>
          <span style="flex:1;text-align:left;color:var(--text-dim)">${esc(x.primaryDescription || '')}</span>
          <span class="num" style="color:var(--muted)">${esc(x.filingDate)}</span>
        </a>`
    )
    .join('');
  $('#tab-content').innerHTML = `<div class="card"><h3>SEC Filings — ${esc(f.name || '')} (CIK ${esc(f.cik)})</h3>${items}</div>`;
}

/* ----------------------------- Notes ----------------------------- */
function renderNotes() {
  const key = `notes:${state.symbol}`;
  const saved = localStorage.getItem(key) || '';
  $('#tab-content').innerHTML = `
    <div class="section-title">Research notes — ${esc(state.symbol)}</div>
    <textarea id="notes" placeholder="Your thesis, valuation assumptions, catalysts, risks…">${esc(saved)}</textarea>
    <div class="notes-meta" id="notes-meta">Saved locally in your browser.</div>`;
  const ta = $('#notes');
  let t;
  ta.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      localStorage.setItem(key, ta.value);
      $('#notes-meta').textContent = 'Saved · ' + new Date().toLocaleTimeString();
    }, 400);
  });
}

/* ----------------------------- Compare ----------------------------- */
function showView(which) {
  $('#welcome').hidden = which !== 'welcome';
  $('#dossier').hidden = which !== 'dossier';
  $('#compare-view').hidden = which !== 'compare';
}

async function renderCompare() {
  showView('compare');
  const el = $('#compare-table');
  if (!state.watchlist.length) {
    el.innerHTML = '<div class="empty">Add tickers to your watchlist to compare them.</div>';
    return;
  }
  el.innerHTML = '<div class="empty">Loading snapshots…</div>';
  const snaps = await Promise.all(
    state.watchlist.map((s) => api(`/api/snapshot?symbol=${encodeURIComponent(s)}`).catch(() => ({ symbol: s, error: true })))
  );
  const metrics = [
    ['Price', (s) => fmtPrice(s.price)],
    ['Change %', (s) => ({ text: signed(s.changePercent, (n) => fmtPct(n)), cls: colorClass(s.changePercent) })],
    ['Market Cap', (s) => fmtBig(s.marketCap)],
    ['P/E', (s) => fmtPrice(s.pe)],
    ['Fwd P/E', (s) => fmtPrice(s.forwardPe)],
    ['Div Yield', (s) => fmtPct(s.dividendYield)],
    ['Beta', (s) => fmtPrice(s.beta)],
    ['Profit Margin', (s) => fmtPct(s.profitMargin)],
    ['Rev Growth', (s) => ({ text: fmtPct(s.revenueGrowth), cls: colorClass(s.revenueGrowth) })],
    ['Mean Target', (s) => fmtPrice(s.targetMean)],
    ['Rating', (s) => esc(s.recommendation || '—')],
    ['52W High', (s) => fmtPrice(s.week52High)],
    ['52W Low', (s) => fmtPrice(s.week52Low)],
  ];
  const head = '<th>Metric</th>' + snaps.map((s) => `<th><a class="link" data-sym="${esc(s.symbol)}" style="cursor:pointer;color:var(--accent)">${esc(s.symbol)}</a></th>`).join('');
  const rows = metrics
    .map(([label, fn]) => {
      const cells = snaps
        .map((s) => {
          if (s.error) return '<td>—</td>';
          const v = fn(s);
          return typeof v === 'object' ? `<td class="num ${v.cls}">${v.text}</td>` : `<td class="num">${v}</td>`;
        })
        .join('');
      return `<tr><td>${label}</td>${cells}</tr>`;
    })
    .join('');
  el.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  el.querySelectorAll('[data-sym]').forEach((a) => a.addEventListener('click', () => selectTicker(a.dataset.sym)));
}

/* ----------------------------- Wire up ----------------------------- */
function init() {
  initSearch();
  renderWatchlist();

  $('#watchlist').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      e.stopPropagation();
      toggleWatchlist(rm.dataset.remove);
      return;
    }
    const item = e.target.closest('.wl-item');
    if (item) selectTicker(item.dataset.sym);
  });

  $('#add-current').addEventListener('click', () => {
    if (state.symbol && !inWatchlist(state.symbol)) {
      toggleWatchlist(state.symbol);
      if (!$('#dossier').hidden) renderHeader();
    }
  });

  $('#compare-btn').addEventListener('click', renderCompare);
  $('#compare-close').addEventListener('click', () => {
    if (state.symbol) showView('dossier');
    else showView('welcome');
  });

  document.querySelectorAll('.quick button').forEach((b) =>
    b.addEventListener('click', () => selectTicker(b.dataset.sym))
  );

  // Deep link via hash
  const hash = location.hash.replace('#', '').trim().toUpperCase();
  if (hash) loadTicker(hash);
}

document.addEventListener('DOMContentLoaded', init);
