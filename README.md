# BTC Race 24h — dip-buy bot

[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/kaffin02/btc-race-24h-dip-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/kaffin02/btc-race-24h-dip-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

Entry for the [make.fun bounty `btc-race-24h-20261117-0603`](https://make.fun/bounty/btc-race-24h-20261117-0603) ("Race a BTC trading
bot live for 24 hours"). One file, `main.ts` (Node 22, erasable TypeScript),
plus the vendored protocol shim in `vendor/makefun-bars.ts`. No dependencies,
no network, no clock, no randomness — fully deterministic.

## Strategy

Long-only cbBTC vs USDC, 1-minute bars, $1,000 paper capital. A full-size
round trip costs ~30 bps (4 bps fee + 2 bps slippage + ~24 bps price impact
against ~$0.9M pool depth), while most 1-minute moves are under 10 bps — so
the bot trades rarely, only for big, well-defined moves.

- **Entry (dip-buy):** when flat, buy 100% of cash if the close is at least
  100 bps below the 120-bar high (prior bars) and the 15-minute return is not
  negative (the dip has stopped falling).
- **Exit:** hard stop 200 bps below the entry close. Otherwise, once the
  running peak is at least 150 bps above the entry close, a trailing stop
  30 bps below that peak.
- **Discipline:** 60-bar cooldown after an exit, at most 2 round trips per
  run, `max_slippage_bps` 100 (rejects gap fills only). If still holding at
  the end, the harness flattens the position.

## Dev-window results (grade-local, --driver process)

| config | net PnL | trades | max drawdown |
| --- | --- | --- | --- |
| this bot (gate 150 / trail 30) | **+$22.14** | 4 | 1.32% |
| gate 150 / trail 25 | +$22.40 | 4 | 1.32% |
| gate 150 / trail 40 | +$20.40 | 4 | 1.32% |
| gate 100 / trail 30 | +$15.79 | 4 | 1.32% |
| momentum baseline | +$2.45 | 1 | 2.12% |
| buy-and-hold baseline | +$1.07 | 1 | 2.12% |
| ema-cross baseline | −$106.21 | 68 | 10.96% |

Guardrails met (≥1 trade, drawdown ≤ 25%). Two executions reproduce the
action log byte for byte (deterministic). 0 rejected orders.

Robustness checks (exact-fill backtester, same fill math as the harness):
gate 150 / trail 30 also beats gate 100 / trail 30 on rescaled windows
(moves ×0.4: +$5.29 vs +$2.72; ×0.6: +$11.44 vs +$7.61; ×1.5: +$39.41 vs
+$29.83) and caps the loss on an inverted (downtrend) window at about −$37
with max drawdown 4.3%.

## Run locally

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

## License

MIT — see `LICENSE`.
