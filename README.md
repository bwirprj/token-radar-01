# Signal Radar

A pre-token protocol board built for make.fun's "Build the best token launch radar" bounty.

Signal Radar reads the sealed DefiLlama snapshot and ranks protocols whose index entry records no token. Every row gets an implied value from the same function of the snapshot's own figures: TVL, seven-day TVL change, and how long the record has run with no token. The 40-protocol watchlist is the floor; the early radar adds 160 pre-token protocols below it. Protocols that already trade are set aside in a separate live-token view. Each row carries an eight-step farm plan with a cost and a time for every step.

The dashboard is a plain static page with sorting, a category filter, a token-status tab and a detail view. It runs with no network: all data is in `data.js`.

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bwirprj/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bwirprj/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

[Enter the bounty on make.fun](https://make.fun/bounty/token-radar-01)

## Run locally

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

The program writes `out/board.json`, `out/data.js`, the `out/dashboard/` page, the three `out/screenshots/` images and `out/dossier.json`. Node 22.18 or later is required.
