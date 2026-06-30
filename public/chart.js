// Chart rendering on top of TradingView's lightweight-charts.
// Exposes window.StockChart with render(bars, options).
(function (global) {
  const COLORS = {
    bg: '#121823',
    grid: '#1a2230',
    text: '#8b97a7',
    up: '#2ebd85',
    down: '#f0616d',
    sma: '#e8b339',
    ema: '#5aa9e6',
    bb: 'rgba(138, 100, 220, 0.7)',
    vol: 'rgba(90, 169, 230, 0.35)',
  };

  let priceChart = null;
  let indChart = null;
  let series = {};

  function baseOptions(height) {
    return {
      height,
      layout: { background: { color: COLORS.bg }, textColor: COLORS.text, fontSize: 11 },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.grid },
      timeScale: { borderColor: COLORS.grid, timeVisible: false },
      crosshair: { mode: 0 },
    };
  }

  function destroy() {
    if (priceChart) priceChart.remove();
    if (indChart) indChart.remove();
    priceChart = indChart = null;
    series = {};
  }

  // bars: [{time(sec), open, high, low, close, volume}]
  function render(bars, opts) {
    const priceEl = document.getElementById('price-chart');
    const indEl = document.getElementById('indicator-chart');
    if (!priceEl || !bars.length) return;
    destroy();

    const LWC = global.LightweightCharts;
    priceChart = LWC.createChart(priceEl, {
      ...baseOptions(priceEl.clientHeight || 420),
      width: priceEl.clientWidth,
    });

    const closes = bars.map((b) => b.close);

    // Price as candlesticks
    const candle = priceChart.addCandlestickSeries({
      upColor: COLORS.up,
      downColor: COLORS.down,
      borderUpColor: COLORS.up,
      borderDownColor: COLORS.down,
      wickUpColor: COLORS.up,
      wickDownColor: COLORS.down,
    });
    candle.setData(
      bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
    );

    // Volume on its own scale at the bottom
    const vol = priceChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: COLORS.vol,
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(
      bars.map((b) => ({
        time: b.time,
        value: b.volume || 0,
        color: b.close >= b.open ? 'rgba(46,189,133,0.4)' : 'rgba(240,97,109,0.4)',
      }))
    );

    const line = (data, color, width = 1.5) => {
      const s = priceChart.addLineSeries({ color, lineWidth: width, priceLineVisible: false, lastValueVisible: false });
      s.setData(data);
      return s;
    };
    const toLine = (arr) =>
      arr.map((v, i) => (v == null ? null : { time: bars[i].time, value: v })).filter(Boolean);

    const I = global.Indicators;
    if (opts.sma) line(toLine(I.sma(closes, 50)), COLORS.sma);
    if (opts.ema) line(toLine(I.ema(closes, 20)), COLORS.ema);
    if (opts.bb) {
      const bb = I.bollinger(closes, 20, 2);
      line(toLine(bb.upper), COLORS.bb, 1);
      line(toLine(bb.lower), COLORS.bb, 1);
    }

    priceChart.timeScale().fitContent();

    // Lower indicator pane: RSI or MACD
    if (opts.indicator && opts.indicator !== 'none' && indEl) {
      indEl.style.display = 'block';
      indChart = LWC.createChart(indEl, {
        ...baseOptions(indEl.clientHeight || 150),
        width: indEl.clientWidth,
      });
      if (opts.indicator === 'rsi') {
        const rsi = I.rsi(closes, 14);
        const s = indChart.addLineSeries({ color: COLORS.ema, lineWidth: 1.5 });
        s.setData(toLine(rsi));
        [30, 70].forEach((lvl) =>
          s.createPriceLine({ price: lvl, color: COLORS.grid, lineWidth: 1, lineStyle: 2 })
        );
      } else if (opts.indicator === 'macd') {
        const m = I.macd(closes);
        const hist = indChart.addHistogramSeries({});
        hist.setData(
          m.hist
            .map((v, i) =>
              v == null
                ? null
                : { time: bars[i].time, value: v, color: v >= 0 ? COLORS.up : COLORS.down }
            )
            .filter(Boolean)
        );
        const ml = indChart.addLineSeries({ color: COLORS.sma, lineWidth: 1.5 });
        ml.setData(toLine(m.line));
        const sl = indChart.addLineSeries({ color: COLORS.ema, lineWidth: 1.5 });
        sl.setData(toLine(m.signal));
      }
      indChart.timeScale().fitContent();
      // keep the two time scales in sync
      priceChart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (r && indChart) indChart.timeScale().setVisibleLogicalRange(r);
      });
    } else if (indEl) {
      indEl.style.display = 'none';
    }
  }

  // Resize handler
  global.addEventListener('resize', () => {
    const priceEl = document.getElementById('price-chart');
    if (priceChart && priceEl) priceChart.applyOptions({ width: priceEl.clientWidth });
    const indEl = document.getElementById('indicator-chart');
    if (indChart && indEl) indChart.applyOptions({ width: indEl.clientWidth });
  });

  global.StockChart = { render, destroy };
})(window);
