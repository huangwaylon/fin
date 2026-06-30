# The Long-Term Decision Playbook

A narrative walkthrough of one morning session: how a senior analyst, with an LLM
as a co-pilot, uses this tool to form and **validate** a 1-year-plus buy/sell
decision. The tool produces structured inputs; the analyst owns the decision.

We'll work two names: **MSFT** (a quality compounder) and **O** (Realty Income,
a REIT — included to show where the model holds its tongue).

---

## 0. What the scores actually are

The composite is a **0–100 blend of six absolute-threshold factors** (not
cross-sectional ranks), weighted as below. It maps to a rating band:

| Factor | Weight | Band | Score |
| --- | --- | --- | --- |
| Quality | 0.22 | Strong Buy | ≥ 80 |
| Value | 0.20 | Buy | 65–79 |
| Growth | 0.18 | Hold | 50–64 |
| Health | 0.15 | Reduce | 35–49 |
| Momentum | 0.15 | Avoid | < 35 |
| Shareholder yield | 0.10 | | |

Two numbers travel with every score and matter as much as the score itself:

- **Coverage** — fraction of inputs that were actually present. Low coverage = thin evidence.
- **Conviction (0–1)** — coverage discounted by **factor dispersion**. When factors
  disagree (great quality, terrible value), conviction falls. A 72 with conviction
  0.4 is a different animal from a 72 with conviction 0.85.

The score is a **first-pass screen and a checklist**, never a verdict.

---

## 1. Idea generation — watchlist, compare, screen

Open the **Watchlist**. Pull the names you track into **Compare** and sort by
composite. The job here is triage: which names changed band since last week, and
which dispersions are wide enough to be interesting.

A wide gap between factors is the signal worth chasing. MSFT screening as
**quality 80s / value 30s** is the classic *"wonderful company, wrong price."*
That tension is the thesis hook — not a reason to skip, a reason to dig.

**Do not trust the rating on financials or REITs.** The factor model masks inputs
that are meaningless by sector:

- `financial` → masks EV/EBITDA, net-debt/EBITDA, current ratio, interest
  coverage, D/E, FCF and FCF-derived inputs (banks run on leverage by design).
- `realestate` → masks earnings yield, PEG, net-debt/EBITDA, D/E (REIT GAAP
  earnings and book value are distorted by depreciation).

For these the brief returns `reliability: 'limited'` and the rating is flagged
**"screen only — not actionable."** So `O` is a candidate to *research*, never a
candidate to rank against MSFT on the composite. Treat its score as a coverage
note, not a call.

---

## 2. Forming a thesis — the Decision tab

Open MSFT → **Decision**. Read it in this order:

1. **Score, rating, conviction, coverage, reliability** — the headline and how
   much to lean on it.
2. **Factor table** — where the score comes from. High quality + low value tells
   you the debate is *price*, not *business*.
3. **Valuation block** — the heart of a long-term thesis:
   - **FCFF DCF fair value**, **Graham multiples** cross-check, and the **blended
     fair value**.
   - **Margin of safety** = how far price sits below blended fair value.
   - **Reverse-DCF market-implied growth** vs the model's **assumed stage-1
     growth**. This is the single most useful long-term number: it converts
     "expensive" into a falsifiable claim. If the market implies 14% and you can't
     defend more than 9%, the bear case writes itself. The brief raises a flag
     when implied growth runs **>5pp above** the model's estimate.
4. **Signals** — trend (vs 200d MA), 12–1 momentum, annualized vol, max drawdown.
   Context, not triggers.
5. **Bull / bear bullets and risk flags** — auto-derived from the data, never
   invented. Empty bull bullets is itself information.

By the end you should be able to state the thesis in one sentence and name the one
assumption it stands on (usually the growth rate or the margin trajectory).

---

## 3. Bringing in the LLM

Pull the machine-readable brief and paste it into your LLM. The markdown format is
built for exactly this:

```
GET /api/brief?symbol=MSFT&format=md
```

It contains the score, factor table, valuation (incl. implied vs assumed growth
and the framing), signals, bull/bear, risk flags, and recent headlines — numbers
only, with a disclaimer footer.

**Prompt (a) — summarize the tension:**

```
Here is a structured decision brief for MSFT. In 5 bullets, state the core
investment debate. Be explicit about which factors disagree and what single
variable the valuation hinges on.

<paste brief markdown>
```

**Prompt (b) — stress-test the thesis** (the important one):

```
My thesis: MSFT is a high-quality compounder mispriced on near-term multiple fear.
Argue the BEAR side as hard as you can using only this brief. Where does the
reverse-DCF implied growth sit vs the model's assumed growth, and what would have
to be true for the market's implied number to be right?
```

**Prompt (c) — draft research questions:**

```
List the 8 questions I must answer from primary sources (10-K, earnings) before I
can hold this for 1+ year. Rank by how much each could break the thesis.
```

The LLM never sees prices it can invent — it reasons over the numbers you handed
it. Treat its output as a structured reading partner, not an oracle.

---

## 4. Validating — primary sources beat the score

The score got you a hypothesis. Validation is where the human earns the fee. Work
the dossier tabs against the LLM's research questions:

- **Filings** — open the 10-K / 10-Q. Read MD&A and the risk factors for the one
  variable your thesis hinges on (segment growth, margin, customer concentration).
- **News / Filings full text** — paste a URL into the article extractor to pull
  full text (`GET /api/article?url=...`), including FT via the Googlebot strategy.
  Read the actual argument, not the headline merge from `/api/news`.
- **Ownership** — insider buying/selling and institutional concentration. Heavy
  insider selling into your bull case is a yellow flag worth a sentence in Notes.
- **Earnings** — the multi-quarter trend. Is the growth the DCF assumes actually
  showing up, or decelerating? A declining-earnings or declining-revenue risk flag
  in the brief should be confirmed here.
- **Valuation sensitivity grid** — stress your own assumptions. Move the growth and
  discount rate to your *defensible* numbers and watch fair value move. If margin
  of safety survives a haircut to growth, the thesis is robust; if it evaporates,
  you're underwriting optimism.
- **Backtest** (`GET /api/backtest`) — read it as **risk context only**. It's a
  walk-forward price-signal backtest vs buy & hold (CAGR, vol, Sharpe, Sortino,
  **max drawdown**) and it is **descriptive, not predictive**. Use the drawdown to
  ask "can I hold this through a 45% peak-to-trough?" — never as a buy signal.

For `O`, validation *replaces* the score entirely: read the filings for FFO/AFFO,
occupancy, lease terms and the cost of debt. The composite told you nothing
actionable, and that's by design.

---

## 5. Deciding and sizing

Convert the inputs into a position. The decision is a function of three things the
tool gives you and one it doesn't:

| Input | Source | Reads as |
| --- | --- | --- |
| Margin of safety | Valuation block | Is there a cushion at today's price? |
| Conviction | Scorecard | How much do the factors agree / how complete is the data? |
| Thesis durability | Your filings work | Does the one key variable hold for 1y+? |
| Position size | **You** | The tool does no sizing math |

A high margin of safety with high conviction and a thesis you've confirmed in the
10-K is a full-size buy. A thin margin of safety with split factors is a starter or
a pass. Size is always a human judgment — the tool deliberately does no
portfolio or position-sizing math.

Then write it down in **Notes** (saved locally per ticker):

- **The thesis**, in one sentence, and the **one variable** it depends on.
- **Falsification** — what would change your mind. Be concrete: *"market-implied
  growth was 11%; if two consecutive quarters print sub-8% cloud growth, the DCF
  premise is wrong and I'm out."*
- **Quarterly re-check list** — earnings trend, any new risk flags in the brief,
  whether margin of safety has closed, and whether the reverse-DCF implied growth
  has drifted away from what you can defend.

Re-run the brief each quarter and diff it against the Notes. The thesis is a live
position, not a one-time bet.

---

## What this tool does NOT do

> - **No moat or qualitative analysis.** It scores numbers; it can't tell you
>   *why* margins are high or whether they last. That's your job (and the LLM's, on
>   primary sources).
> - **Sector-blind on cyclicals.** Absolute thresholds flatter the top of a cycle
>   and punish the bottom. A peak-margin cyclical can screen "Strong Buy" right
>   before it rolls over.
> - **Limited on financials & REITs.** Masked inputs, `reliability: 'limited'`,
>   "screen only." Do not rank these on the composite.
> - **No portfolio or position-sizing math.** No correlation, no risk budget, no
>   Kelly. Sizing is entirely on you.
> - **The backtest is descriptive, not predictive.** Walk-forward price-signal
>   stats are risk context (drawdown, vol), never a buy signal.
> - **Not investment advice.** Generated by an automated model from third-party
>   data. Verify independently before acting.

The scores and the LLM are inputs. The analyst is the decision-maker.
