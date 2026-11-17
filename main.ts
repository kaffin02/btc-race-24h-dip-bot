// BTC Race 24h — dip-buy bot v2 for make.fun (agent-fun/bars-replay/v1).
//
// v2 improves on v1 (+$22.14 dev) by entering dips earlier and on a shorter
// lookback, after a broad sweep of the dip-buy family (see the sweep logs in
// btc-race-bot-dev/): 9,216 refined combos were tested; the chosen config
// sits in the middle of a wide plateau (387 combos >= $28, 138 >= $30),
// not on a knife edge. What changed vs v1:
//   - lookback 120 -> 90 bars for the reference high (dips register sooner),
//   - dip threshold 100 -> 120 bps below that high,
//   - recovery filter 0 -> -20 bps on the 15-minute return: v1 waited for
//     the dip to stop falling; v2 buys while the fall is still shallow,
//     which catches the bottom of the fast V-shaped recoveries earlier.
//   - max round trips 2 -> 10 (dev window only uses 2; the cap is a live
//     safety bound, not a dev-window constraint).
// Exit is unchanged in shape: hard stop 200 bps below entry; once the
// running peak is at least 150 bps above the entry close, a trailing stop
// 30 bps below that peak. After an exit, a 60-bar cooldown.
//
//   entry:  close is at least 120 bps below the 90-bar high (prior bars)
//           and the 15-minute return is at least -20 bps (falling, but
//           not plunging). Buys 100% of cash, long only.
//   exit:   hard stop 200 bps below the entry close; otherwise, once the
//           running peak is at least 150 bps above the entry close, a
//           trailing stop 30 bps below that peak. After an exit, a 60-bar
//           cooldown before the next entry.
//   risk:   at most 10 round trips; dev max drawdown 0.84%, far below the
//           25% guardrail. Stress: on a time-reversed dev window the bot
//           is ~breakeven (+$0.06, DD 1.11%); on a price-reflected window
//           +$8.03 (DD 1.45%) — it does not blow up when the trend flips.
//
// Deterministic: pure integer (bigint) comparisons, no clock, no randomness,
// no network, no files. The only state is the close history and the small
// trade state machine below.
import { runBars } from "./makefun-bars.ts";
import type { BarsState, Batch, OrderInput } from "./makefun-bars.ts";

const SYMBOL = "CBBTC";

// Entry: dip of at least this many bps below the 90-bar high.
const DIP_BPS = 120n;
// Entry confirmation: 15-minute return must be >= this many bps (negative:
// buy while the fall is still shallow).
const RECOVERY_BPS = -20n;
// Bars of history used for the reference high.
const LOOKBACK_BARS = 90;
// Trailing stop activates once the peak is this far above the entry.
const GATE_BPS = 150n;
// Trailing stop distance below the running peak, once activated.
const TRAIL_BPS = 30n;
// Hard stop below the entry close.
const HARD_STOP_BPS = 200n;
// Bars to wait after an exit before the next entry.
const COOLDOWN_BARS = 60;
// At most this many completed round trips per run.
const MAX_ROUND_TRIPS = 10;
// Max slippage vs the latest close accepted on a fill (1-minute moves in the
// dev window stay well under 45 bps, so 100 bps only rejects gap fills).
const MAX_SLIPPAGE_BPS = 100;

const BPS = 10_000n;

type Phase = "flat" | "pending-buy" | "holding" | "pending-sell";

const closes: bigint[] = [];
let phase: Phase = "flat";
let entryClose = 0n;
let peakClose = 0n;
let buyBar = -1;
let sellBar = -1;
let roundTrips = 0;
let cooldownUntil = -1;

function barIndex(): number {
  return closes.length - 1;
}

/** Highest close of the LOOKBACK_BARS bars before the current one, or null. */
function priorHigh(): bigint | null {
  const k = barIndex();
  if (k < LOOKBACK_BARS) return null;
  let hi = closes[k - LOOKBACK_BARS]!;
  for (let i = k - LOOKBACK_BARS + 1; i < k; i++) {
    if (closes[i]! > hi) hi = closes[i]!;
  }
  return hi;
}

function heldQty(state: BarsState): bigint {
  return state.positions.get(SYMBOL)?.qty ?? 0n;
}

function onBatch(state: BarsState, batch: Batch): OrderInput[] {
  if (state.warmingUp) return [];
  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  if (bar === undefined) return [];
  const close = BigInt(bar.c);
  closes.push(close);
  const k = barIndex();
  const qty = heldQty(state);

  // Reconcile the trade state machine with the account the harness reports.
  if (phase === "pending-buy") {
    if (qty > 0n) {
      phase = "holding";
    } else if (k > buyBar) {
      // The buy was rejected (e.g. max slippage): back to flat.
      phase = "flat";
      entryClose = 0n;
      peakClose = 0n;
    }
  } else if (phase === "pending-sell") {
    if (qty === 0n) {
      phase = "flat";
      roundTrips += 1;
      cooldownUntil = k + COOLDOWN_BARS;
      entryClose = 0n;
      peakClose = 0n;
    } else if (k > sellBar) {
      // The sell was rejected: resume holding with the same entry/peak.
      phase = "holding";
    }
  }

  if (phase === "holding") {
    if (close > peakClose) peakClose = close;
    const hitHardStop = close * BPS <= (entryClose * (BPS - HARD_STOP_BPS));
    const gateReached = peakClose * BPS >= entryClose * (BPS + GATE_BPS);
    const hitTrail = gateReached && close * BPS <= peakClose * (BPS - TRAIL_BPS);
    if ((hitHardStop || hitTrail) && qty > 0n) {
      sellBar = k;
      phase = "pending-sell";
      return [{ side: "sell", symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  if (phase === "flat") {
    if (roundTrips >= MAX_ROUND_TRIPS || k < cooldownUntil) return [];
    if (state.cash <= 0n) return [];
    const hi = priorHigh();
    if (hi === null || k < 15) return [];
    const dipped = close * BPS <= (hi * (BPS - DIP_BPS));
    const recovered = (close - closes[k - 15]!) * BPS >= RECOVERY_BPS * closes[k - 15]!;
    if (dipped && recovered) {
      entryClose = close;
      peakClose = close;
      buyBar = k;
      phase = "pending-buy";
      return [{ side: "buy", symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }
    return [];
  }

  return [];
}

await runBars({ onBatch });
