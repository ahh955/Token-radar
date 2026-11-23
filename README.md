# Token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ahh955/Token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ahh955/Token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by an implied token value from a fitted comps curve: log market cap on log TVL over the traded tokens, one row per ticker, with a shrunk category effect, small capped growth and seasoning tilts, and token odds from the peers' record by age bucket — implied value is value-if-launches times odds. Every term is tested held-out twice (leave-one-out and older tokens pricing newer ones) against a flat-multiple baseline, and the board prints the ablation table, the range honesty, and a bootstrap rank range per row. All 758 snapshot protocols are accounted for (ranked, already trading, or set aside by rule), and every row carries a costed farm verdict — FARM, MARGINAL-THIN or SKIP — from a slice of the implied value net of per-chain gas and the 4% T-bill forgone, with a step-by-step plan that states its cost and time. The dashboard is a static dark-themed page that recomputes every row in the browser: a sortable, filterable board, a full-page detail view per protocol with the value decomposition and nearest traded peers, a live-token view, and a method tab with the scatter plot and the out-of-sample results. Round 4 adds a second evidence panel (the token-odds Brier ladder and the peers'-record bar chart), "Best farms now" cards, a break-even odds line, and a peers table that hides outliers more than 10× off the curve — the model itself is unchanged from round 3. It runs fully offline with zero network requests.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Then serve `out/` and open `dashboard/index.html`. Node.js 22 or later is all it needs — no build step, no dependencies. The four screenshots in `screenshots/` are renders of the dashboard itself: the board, a protocol's detail view, a FARM-only filtered view, and the method tab.

<sub>Entered on [make.fun](https://make.fun/?ref=xsff4jzh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
