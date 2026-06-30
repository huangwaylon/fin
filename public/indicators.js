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
    // Seed with the SMA of the first `period` NON-NULL points. Skipping nulls is
    // essential: a single null inside a fixed-window seed (Yahoo emits sporadic
    // null closes) would make the seed — and every subsequent EMA value — NaN,
    // silently poisoning the EMA overlay and both MACD lines.
    let seedSum = 0;
    let seedCount = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null) continue;
      if (prev == null) {
        seedSum += v;
        seedCount += 1;
        if (seedCount === period) {
          prev = seedSum / period;
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
          // 0/0 (a perfectly flat window) is undefined RSI -> neutral 50, not 100.
          out[i] = avgL === 0 ? (avgG === 0 ? 50 : 100) : 100 - 100 / (1 + avgG / avgL);
          gain = avgG;
          loss = avgL;
        }
      } else {
        gain = (gain * (period - 1) + up) / period;
        loss = (loss * (period - 1) + down) / period;
        out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
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
    // ema() now skips nulls, so feed the MACD line directly — no zero-fill hack
    // (the old `null -> 0` substitution injected fake zeros into the signal EMA).
    const sig = ema(line, signal);
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
