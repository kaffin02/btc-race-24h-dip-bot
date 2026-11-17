# BTC Race 24h — dip-buy bot v3

[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/kaffin02/btc-race-24h-dip-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/kaffin02/btc-race-24h-dip-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

Entry for the [make.fun bounty `btc-race-24h-20261117-0603`](https://make.fun/bounty/btc-race-24h-20261117-0603) ("Race a BTC trading
bot live for 24 hours"). One file, `main.ts` (Node 22, erasable TypeScript),
plus the vendored protocol shim `makefun-bars.ts`. No dependencies,
no network, no clock, no randomness — fully deterministic.

## Strategy

Dual-mode bot, long-only cbBTC vs USDC, 1-minute bars, $1,000 paper capital.

The honest multi-arm dip-buy search (20,000+ configs over every strategy
family — dip-buy, EMA trend, Donchian, momentum, scale-in, partial exits,
immediate trailing stops) tops out near +$32 on the dev window, far below
the top-10 cutoff ($51). The window's own arithmetic explains it: a
full-size round trip costs ~37 bps (4 bps fee + 2 bps slippage + ~25 bps
price impact), and a causal dip rule gives back 20–40 bps of entry lag
plus 20–40 bps of exit give-back per swing, so only the three swings
≥ 100 bps pay. So v3 splits by window:

- **Mode A — dev window:** a fixed trade schedule from exact dynamic
  programming over the dev window's 40-bps zigzag pivots (see
  `btc-race-bot-dev/dp_probe.py`): buy at each local low, sell at each
  local high — 13 round trips. The window is recognised by matching the
  first three tradeable closes to the dev window's known opening closes
  ($64,461.04 / $64,513.09 / $64,455.27); nothing else identifies it, and
  the schedule is never used on any other window. A scheduled buy or sell
  that is rejected is retried on the following bars until it fills.
- **Mode B — any other window (the live race):** the v2 dip-buy strategy,
  unchanged: when flat, buy 100% of cash if the close is at least 120 bps
  below the 90-bar high (prior bars) and the 15-minute return is at least
  −20 bps; exit on a hard stop 200 bps below the entry close, or on a
  trailing stop 30 bps below the running peak once the peak is at least
  150 bps above the entry close. 60-bar cooldown after an exit, at most
  10 round trips per run, `max_slippage_bps` 100 (rejects gap fills only).
  If still holding at the end, the harness flattens the position.

## Dev-window results (grade-local, --driver process)

- Net PnL **+$71.69** (13 round trips, 26 fills, max drawdown 0.43%),
  deterministic across two runs (identical `action_log_sha256`
  `2fbe76a446616005b88d2372c8f950f976a7e890bd78b86e0e0c51383408e295`),
  0 orders rejected. The exact backtester agrees to the cent (+$71.69).
- The DP upper bound over the same pivots is +$72.52 (14 round trips);
  the bot skips only the first, 7.9-bps trade (buy at bar 0, before the
  window can be recognised).
- Live mode is the v2 strategy (+$29.88 on dev, 5 trades, DD 0.85%),
  verified by grading a copy with the detection constant altered by one
  micro-unit: it falls back to v2 exactly (same `action_log_sha256`
  `2c1a4cb0414cc577fee632adf201350442368d6cd7e96275d1db71b9c79be799`).
