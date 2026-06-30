// Normalize a Yahoo quoteSummary result (+ optional price bars) into one clean,
// flat fundamentals object that every downstream module (factors, valuation,
// brief) consumes. Missing inputs become null — never guessed.
import { raw, isNum, clamp, cagr, mean } from './quantutil.js';
import { computeSignals } from './signals.js';

const abs = (x) => (isNum(x) ? Math.abs(x) : null);
const div = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

// Classify sector for sector-aware factor handling. Financials and real estate
// break the standard quality/value/leverage metrics, so we tag them and mask the
// inapplicable inputs downstream rather than scoring them wrongly.
function classifySector(sector, industry) {
  const s = (sector || '').toLowerCase();
  const i = (industry || '').toLowerCase();
  if (s.includes('financial') || i.includes('bank') || i.includes('insurance') || i.includes('capital markets'))
    return 'financial';
  if (s.includes('real estate') || i.includes('reit')) return 'realestate';
  return 'standard';
}

export function extract(result, bars) {
  const r = result || {};
  const price = r.price || {};
  const detail = r.summaryDetail || {};
  const stats = r.defaultKeyStatistics || {};
  const fin = r.financialData || {};
  const incomes = r.incomeStatementHistory?.incomeStatementHistory || [];
  const cashflows = r.cashflowStatementHistory?.cashflowStatements || [];
  const yearly = r.earnings?.financialsChart?.yearly || [];

  const px = raw(price.regularMarketPrice);
  const marketCap = raw(price.marketCap);
  const sharesOut = raw(stats.sharesOutstanding) ?? div(marketCap, px);
  const revenue = raw(fin.totalRevenue);
  const ebitda = raw(fin.ebitda);
  const netMargin = raw(fin.profitMargins);
  const operatingMargin = raw(fin.operatingMargins);
  const fcf = raw(fin.freeCashflow);
  const totalDebt = raw(fin.totalDebt);
  const totalCash = raw(fin.totalCash);
  const trailingPE = raw(detail.trailingPE);

  // Latest annual income statement (newest first in Yahoo's array). Yahoo's
  // income-statement fields are increasingly sparse/unreliable (ebit often 0,
  // operatingIncome sometimes empty), so derive EBIT from the dependable TTM
  // operating margin × revenue, falling back to the statement fields if needed.
  const inc0 = incomes[0] || {};
  const ebitRaw = raw(inc0.ebit);
  const ebit =
    isNum(operatingMargin) && isNum(revenue)
      ? operatingMargin * revenue
      : isNum(ebitRaw) && ebitRaw !== 0
        ? ebitRaw
        : raw(inc0.operatingIncome);
  const interestExpense = abs(raw(inc0.interestExpense));

  // Buyback yield averaged over available annual cash flows (a single year is
  // noisy — one issuance can flip it negative). repurchaseOfStock is negative
  // when the company is buying back shares.
  const repos = cashflows.map((c) => raw(c.repurchaseOfStock)).filter(isNum);
  const avgRepo = repos.length ? mean(repos) : null;
  let buybackYield = isNum(avgRepo) && isNum(marketCap) && marketCap > 0 ? -avgRepo / marketCap : null;
  if (isNum(buybackYield)) buybackYield = clamp(buybackYield, -0.1, 0.2); // kill outliers (period mismatch vs current cap)

  // Multi-year CAGRs from the yearly revenue/earnings chart (ascending by year).
  let revCagr3 = null;
  let epsCagr3 = null;
  let cagrYears = null;
  if (yearly.length >= 2) {
    const first = yearly[0];
    const last = yearly[yearly.length - 1];
    cagrYears = yearly.length - 1;
    revCagr3 = cagr(raw(first.revenue), raw(last.revenue), cagrYears);
    epsCagr3 = cagr(raw(first.earnings), raw(last.earnings), cagrYears);
  }

  // Multi-year average net margin from the same yearly chart (earnings/revenue
  // per year). Lets us flag a stock currently earning well above its own history
  // — the classic cyclical "cheap at peak earnings" trap for a long-term buyer.
  const yearlyMargins = yearly
    .map((y) => {
      const rev = raw(y.revenue);
      const earn = raw(y.earnings);
      return isNum(rev) && rev > 0 && isNum(earn) ? earn / rev : null;
    })
    .filter(isNum);
  const avgNetMargin = yearlyMargins.length >= 3 ? mean(yearlyMargins) : null;

  const targetMean = raw(fin.targetMeanPrice);

  // Normalize dividend yield to a fraction. Yahoo usually returns a fraction
  // (0.026) but some endpoints/symbols hand back a percent (2.6); a value > 1 is
  // almost certainly a percent, so divide. Prevents a silent ~100x blow-up of the
  // shareholder-yield / value factors.
  let dividendYield = raw(detail.dividendYield);
  if (isNum(dividendYield) && dividendYield > 1) dividendYield = dividendYield / 100;

  // ROIC ≈ NOPAT / invested capital, with NOPAT = EBIT·(1−tax) and invested
  // capital ≈ total debt + book equity (book equity ≈ marketCap / P/B). This is a
  // rough screen (excludes leases, carries goodwill); null when book equity is
  // unavailable or invested capital is non-positive (e.g. buyback-negative equity)
  // so we never print an absurd ROIC. Compared to WACC in the valuation layer.
  const bookEquity = div(marketCap, raw(stats.priceToBook));
  const investedCapital = isNum(totalDebt) && isNum(bookEquity) ? totalDebt + bookEquity : null;
  const roic =
    isNum(ebit) && isNum(investedCapital) && investedCapital > 0 ? (ebit * (1 - 0.21)) / investedCapital : null;

  // Cash conversion (earnings quality / accruals): operating cash flow vs net
  // income. Persistently < 1 means earnings aren't backed by cash — a long-horizon
  // red flag. Net income approximated from TTM net margin × revenue.
  const operatingCashflow = raw(fin.operatingCashflow);
  const netIncomeTtm = isNum(netMargin) && isNum(revenue) ? netMargin * revenue : null;
  const cashConversion =
    isNum(operatingCashflow) && isNum(netIncomeTtm) && netIncomeTtm > 0 ? operatingCashflow / netIncomeTtm : null;

  return {
    symbol: (price.symbol || '').toUpperCase() || null,
    name: price.longName || price.shortName || null,
    currency: price.currency || 'USD',
    quoteAsOf: isNum(raw(price.regularMarketTime))
      ? new Date(raw(price.regularMarketTime) * 1000).toISOString()
      : null,
    sector: r.assetProfile?.sector || r.summaryProfile?.sector || null,
    industry: r.assetProfile?.industry || r.summaryProfile?.industry || null,
    sectorClass: classifySector(
      r.assetProfile?.sector || r.summaryProfile?.sector,
      r.assetProfile?.industry || r.summaryProfile?.industry
    ),
    cagrYears,
    price: px,
    marketCap,
    sharesOut,
    enterpriseValue: raw(stats.enterpriseValue),

    // Valuation multiples
    pe: trailingPE,
    forwardPe: raw(stats.forwardPE),
    pb: raw(stats.priceToBook),
    ps: raw(detail.priceToSalesTrailing12Months) ?? raw(stats.priceToSalesTrailing12Months),
    evEbitda: raw(stats.enterpriseToEbitda),
    evRevenue: raw(stats.enterpriseToRevenue),
    peg: raw(stats.pegRatio),
    earningsYield: isNum(trailingPE) && trailingPE > 0 ? 1 / trailingPE : null,
    fcfYield: div(fcf, marketCap),

    // Profitability / quality
    roe: raw(fin.returnOnEquity),
    roa: raw(fin.returnOnAssets),
    grossMargin: raw(fin.grossMargins),
    operatingMargin,
    netMargin,
    fcfMargin: div(fcf, revenue),
    interestCoverage: div(ebit, interestExpense),
    roic,
    cashConversion,
    avgNetMargin,
    marginVsHist: isNum(netMargin) && isNum(avgNetMargin) && avgNetMargin > 0 ? netMargin / avgNetMargin : null,

    // Growth
    revenueGrowth: raw(fin.revenueGrowth),
    earningsGrowth: raw(fin.earningsGrowth),
    revCagr3,
    epsCagr3,
    forwardEps: raw(stats.forwardEps),
    trailingEps: raw(stats.trailingEps),

    // Financial health
    debtToEquity: raw(fin.debtToEquity), // Yahoo reports as a percentage (e.g. 79.5 = 0.795x)
    currentRatio: raw(fin.currentRatio),
    quickRatio: raw(fin.quickRatio),
    totalDebt,
    totalCash,
    netDebt: isNum(totalDebt) && isNum(totalCash) ? totalDebt - totalCash : null,
    ebitda,
    netDebtToEbitda:
      isNum(totalDebt) && isNum(totalCash) && isNum(ebitda) && ebitda !== 0
        ? (totalDebt - totalCash) / ebitda
        : null,
    fcf,
    operatingCashflow,
    revenue,

    // Shareholder return
    dividendYield,
    payoutRatio: raw(detail.payoutRatio),
    buybackYield,
    shareholderYield:
      isNum(dividendYield) || isNum(buybackYield)
        ? (dividendYield || 0) + (buybackYield || 0)
        : null,

    // Market / analyst
    beta: raw(detail.beta) ?? raw(stats.beta),
    analystRec: fin.recommendationKey || null,
    analystMean: raw(fin.recommendationMean),
    analystCount: raw(fin.numberOfAnalystOpinions),
    targetMean,
    analystUpside: isNum(targetMean) && isNum(px) && px > 0 ? targetMean / px - 1 : null,

    // Price-derived signals (null if insufficient history)
    signals: computeSignals(bars),
  };
}
