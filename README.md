# BTC Race 24h — dip-buy bot v2

[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/kaffin02/btc-race-24h-dip-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/kaffin02/btc-race-24h-dip-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

Entry for the [make.fun bounty `btc-race-24h-20261117-0603`](https://make.fun/bounty/btc-race-24h-20261117-0603) ("Race a BTC trading
bot live for 24 hours"). One file, `main.ts` (Node 22, erasable TypeScript),
plus the vendored protocol shim `makefun-bars.ts`. No dependencies,
no network, no clock, no randomness — fully deterministic.

## Strategy

Long-only cbBTC vs USDC, 1-minute bars, $1,000 paper capital. A full-size
round trip costs ~30 bps (4 bps fee + 2 bps slippage + ~24 bps price impact
against ~$0.9M pool depth), while most 1-minute moves are under 10 bps — so
the bot trades rarely, only for big, well-defined moves.

- **Entry (dip-buy):** when flat, buy 100% of cash if the close is at least
  120 bps below the 90-bar high (prior bars) and the 15-minute return is at
  least −20 bps (falling, but not plunging — this catches the bottom of fast
  V-shaped recoveries earlier than waiting for the dip to stop falling).
- **Exit:** hard stop 200 bps below the entry close. Otherwise, once the
  running peak is at least 150 bps above the entry close, a trailing stop
  30 bps below that peak.
- **Discipline:** 60-bar cooldown after an exit, at most 10 round trips per
  run, `max_slippage_bps` 100 (rejects gap fills only). If still holding at
  the end, the harness flattens the position.

## Dev-window results (grade-local, --driver process)

| config | net PnL | trades | max drawdown |
| --- | --- | --- | --- |
| **this bot v2** (dip 120 / lb 90 / rec −20) | **+$29.88** | 5 | 0.85% |
| v1 (dip 100 / lb 120 / rec 0) | +$22.14 | 4 | 1.32% |
| momentum baseline | +$2.45 | 1 | 2.12% |
| buy-and-hold baseline | +$1.07 | 1 | 2.12% |
| ema-cross baseline | −$106.21 | 68 | 10.96% |

Guardrails met (≥1 trade, drawdown ≤ 25%). Two executions reproduce the
action log byte for byte (deterministic, `action_log_sha256`
2c1a4cb0414cc577fee632adf201350442368d6cd7e96275d1db71b9c79be799).
0 rejected orders.

Robustness checks (exact-fill backtester, same fill math as the harness):
the v2 config sits in the middle of a wide plateau — 387 swept configs
score ≥ $28 and 138 score ≥ $30 on the dev window, so it is not a
knife-edge optimum. On stress windows it does not blow up: time-reversed
dev window ≈ breakeven (+$0.06, DD 1.11%), price-reflected window +$8.03
(DD 1.45%).

## Run locally

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

## License

MIT — see `LICENSE`.
