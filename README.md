# Token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ahh955/Token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ahh955/Token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token protocols by an implied token value, peer-calibrated on the market itself: each category is priced at the median market cap per dollar of TVL of the tokens already trading in it (falling back to the global median where a category has too few live peers), then tilted by seven-day TVL growth and by how long the protocol has run with no token. The board covers all 40 protocols on the snapshot's watchlist plus the 160 strongest pre-token protocols below the $50M floor, and every row carries a concrete farm plan — a category-specific action, a weekly step, a hold window and a claim-safety check — with its cost and time. The dashboard is a static dark-themed page: a sortable, filterable board, a detail view per protocol with the full value breakdown and live peers, a live-token comparison view, and a methodology section that states the formula, the constants and the per-category peer medians. It runs fully offline with zero network requests.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Then serve `out/` and open `dashboard/index.html`. Node.js 22 or later is all it needs — no build step, no dependencies. The three screenshots in `screenshots/` are renders of the dashboard itself: the board, a protocol's detail view and a filtered view.

<sub>Entered on [make.fun](https://make.fun/?ref=xsff4jzh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
