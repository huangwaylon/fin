# API Reference

All endpoints return JSON (unless noted) and are served by `server.js`. Responses are cached
in-memory for ~1 minute. Missing data is `null`, never fabricated.

## Data endpoints

| Endpoint | Params | Returns |
| --- | --- | --- |
| `GET /api/search` | `q` | Ticker / company search (Yahoo) |
| `GET /api/research` | `symbol` | Full aggregated dossier (all sources, parallel, fault-isolated) |
| `GET /api/snapshot` | `symbol` | Compact metrics for watchlist / compare rows |
| `GET /api/history` | `symbol`, `range`, `interval` | OHLCV bars (Yahoo, Stooq fallback) |
| `GET /api/filings` | `symbol` | SEC EDGAR recent filings |
| `GET /api/options` | `symbol` | Options chain |

## Decision endpoints

| Endpoint | Params | Returns |
| --- | --- | --- |
| `GET /api/score` | `symbol`, `weights?` | Factor scorecard + composite + rating + conviction |
| `GET /api/valuation` | `symbol` | DCF / reverse-DCF / multiples fair value + sensitivity |
| `GET /api/brief` | `symbol`, `format=json\|md` | Full decision brief (JSON, or Markdown for LLM prompting) |
| `GET /api/backtest` | `symbol`, `rule?`, `years?` | Walk-forward price-signal backtest vs buy-and-hold, **plus** a forward 1/2/3-year return distribution (`forwardReturns`) |

`weights` overrides factor weights, e.g. `weights=quality:0.3,value:0.25,growth:0.2` (only
known factor keys with non-negative values are honored). `rule` ∈ `trend_mom` (default) ·
`trend` · `mom` · `buyhold`. `years` is clamped to (0, 30].

## News & research

| Endpoint | Params | Returns |
| --- | --- | --- |
| `GET /api/news` | `symbol` | Merged Yahoo + Google News headlines (de-duplicated) |
| `GET /api/article` | `url` | Readable full-text extraction (JSON-LD/HTML; FT via Googlebot strategy) |

`/api/article` enforces an SSRF guard (http(s) only, no private/loopback hosts).

## The decision brief

`GET /api/brief?symbol=AAPL` returns:

```jsonc
{
  "schemaVersion": "1.0",
  "symbol": "AAPL", "name": "Apple Inc.", "asOf": "…", "price": 281.74,
  "sector": "Technology", "sectorClass": "standard",
  "reliability": "standard",          // "limited" for financials/REITs
  "modelNotes": [],                    // sector / conviction caveats
  "scorecard": {
    "composite": 55, "rating": "Hold", "actionable": true,
    "conviction": 0.5, "coverage": 1, "weights": { … },
    "factors": { "quality": { "score": 95, "coverage": 1, "inputs": [ … ] }, … }
  },
  "valuation": {
    "assumptions": { "stage1Growth": …, "discountRate": …, "costOfEquity": …,
                     "terminalValueShare": …, "model": "…" },
    "dcfValue": 180.4, "multiplesValue": 398.2,   // multiples = cross-check, NOT blended
    "blendedFairValue": 180.4, "marginOfSafety": 0.047,
    "impliedGrowth": 0.264, "analystUpside": 0.118,
    "roic": 0.60, "wacc": 0.093, "valueCreationSpread": 0.508,  // ROIC − WACC
    "sensitivity": [ … ]
  },
  "signals": { "trend": "up", "mom12_1": …, "annualVol": …, "maxDrawdown": … },  // returns use adjusted close
  "fundamentals": { …, "roic": 0.60, "cashConversion": 1.14 },
  "flags": [ … ], "bull": [ … ], "bear": [ … ],
  "news": [ { "title": "…", "publisher": "…", "published": "…" } ],
  "dataQuality": { "summary": "ok", … },
  "disclaimer": "…"
}
```

`format=md` returns the same content as compact Markdown, designed to be pasted into an LLM prompt.
