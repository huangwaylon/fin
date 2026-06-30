// Technical indicators. All functions take an array of closing prices (or bars)
// and return arrays aligned to the input length, with `null` where undefined.
(function (global) {
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null) continue;
      if (prev == null) {
        // seed with SMA of first `period` points
        if (i >= period - 1) {
          let s = 0;
          for (let j = i - period + 1; j <= i; j++) s += values[j];
          prev = s / period;
          out[i] = prev;
        }
      } else {
        prev = v * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(values, period = 14) {
    const out = new Array(values.length).fill(null);
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      const up = Math.max(diff, 0);
      const down = Math.max(-diff, 0);
      if (i <= period) {
        gain += up;
        loss += down;
        if (i === period) {
          const avgG = gain / period;
          const avgL = loss / period;
          out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
          gain = avgG;
          loss = avgL;
        }
      } else {
        gain = (gain * (period - 1) + up) / period;
        loss = (loss * (period - 1) + down) / period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    }
    return out;
  }

  function macd(values, fast = 12, slow = 26, signal = 9) {
    const emaFast = ema(values, fast);
    const emaSlow = ema(values, slow);
    const line = values.map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null
    );
    const compact = line.map((v) => (v == null ? 0 : v));
    const sig = ema(compact, signal).map((v, i) => (line[i] == null ? null : v));
    const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
    return { line, signal: sig, hist };
  }

  function bollinger(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / period);
      upper[i] = mid[i] + mult * sd;
      lower[i] = mid[i] - mult * sd;
    }
    return { mid, upper, lower };
  }

  global.Indicators = { sma, ema, rsi, macd, bollinger };
})(window);
