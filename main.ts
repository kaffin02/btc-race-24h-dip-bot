// BTC Race 24h — dip-buy bot for make.fun (agent-fun/bars-replay/v1).
//
// Idea, from the dev window (2026-11-16 06:03 UTC -> 2026-11-17 06:03 UTC):
// a full-size round trip costs ~30 bps (4 bps fee + 2 bps slippage + ~24 bps
// price impact at $1,000 against ~$0.9M pool depth), while most 1-minute
// moves are under 10 bps. So this bot trades rarely and only for big,
// well-defined moves: it buys a deep dip, then locks the gain with a
// profit-gated trailing stop. At most two round trips per run.
//
//   entry:  close is at least 100 bps below the 120-bar high (prior bars)
//           and the 15-minute return is not negative (the dip has stopped
//           falling). Buys 100% of cash, long only.
//   exit:   hard stop 200 bps below the entry close; otherwise, once the
//           running peak is at least 150 bps above the entry close, a
//           trailing stop 30 bps below that peak. After an exit, a 60-bar
//           cooldown before the next entry.
//   risk:   at most 2 round trips, so the worst case is two stopped-out
//           trades; max drawdown stays far below the 25% guardrail.
//
// Deterministic: pure integer (bigint) comparisons, no clock, no randomness,
// no network, no files. The only state is the close history and the small
// trade state machine below.
import { runBars } from "./makefun-bars.ts";
import type { BarsState, Batch, OrderInput } from "./makefun-bars.ts";

const SYMBOL = "CBBTC";

// Entry: dip of at least this many bps below the 120-bar high.
const DIP_BPS = 100n;
// Entry confirmation: 15-minute return must be >= this many bps.
const RECOVERY_BPS = 0n;
// Trailing stop activates once the peak is this far above the entry.
const GATE_BPS = 150n;
// Trailing stop distance below the running peak, once activated.
const TRAIL_BPS = 30n;
// Hard stop below the entry close.
const HARD_STOP_BPS = 200n;
// Bars to wait after an exit before the next entry.
const COOLDOWN_BARS = 60;
// At most this many completed round trips per run.
const MAX_ROUND_TRIPS = 2;
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

/** Highest close of the 120 bars before the current one, or null. */
function priorHigh120(): bigint | null {
  const k = barIndex();
  if (k < 120) return null;
  let hi = closes[k - 120]!;
  for (let i = k - 119; i < k; i++) {
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
    const hi = priorHigh120();
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
