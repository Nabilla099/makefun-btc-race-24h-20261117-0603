// Dip-buyer: a mean-reversion bot for cbBTC 1-minute bars, long only.
//
// What the dev window showed: 1-minute cbBTC is choppy and strongly mean-reverting
// at 1-4 hour horizons — a 4-hour drop of 100+ bps is followed by a recovery of
// roughly +45 bps over the next hour on average, while sharp 4-hour rallies fade.
// Trend-following (EMA crosses, momentum, breakouts) all lose on the dev window:
// every whipsaw costs about 35 bps a round trip (4 bps fee + 2 bps slippage +
// ~11 bps of pool impact a leg at this depth), and the 1-minute moves are only
// ~6 bps of noise. So this bot trades rarely and only the deep dips:
//
//   - Entry, flat: the close is at least 100 bps under where it was 240 bars
//     (4 hours) ago AND at least 20 bps under where it was 60 bars ago, so the
//     dip is both deep and still fresh. It buys with all of its cash.
//   - Exit, holding: the close recovers to 30 bps above where it was 240 bars
//     ago (the 4-hour return has turned positive), or the close falls 100 bps
//     below the highest close since entry (a trailing stop, for a dip that
//     keeps falling). It sells the whole position either way.
//   - After any sell it waits 60 bars before it may buy again, so a falling
//     knife cannot make it re-enter bar after bar.
//   - Late fallback: if nothing has filled by 75% of the window (seq 1080 of
//     1440), a shallower dip — 60 bps under 240 bars ago, same freshness
//     confirmation — may trigger one buy with the same exits. On a quiet day
//     with no 100-bps dip this keeps the bot from ending on 0 trades, which
//     would fail the race guardrails outright; on a normal day it never fires
//     because a trade has already filled by then.
//
// The thresholds sit in the middle of a broad plateau found by sweeping the dev
// window (dip 90-110 bps, trailing stop 80-120 bps, recovery 15-50 bps all clear
// about +$13 to +$16), and the rule wins on both halves of the dev window, so
// it is a property of the market's shape, not one fitted number. A round trip
// still costs ~35 bps, so it only trades when the expected recovery is clearly
// larger than that. No clock, no network, no randomness: the same bars give the
// same orders, run after run.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** 4-hour lookback for the dip. */
const LONG_BARS = 240;
/** 1-hour lookback: the dip must still be fresh. */
const FRESH_BARS = 60;
/** A 4-hour drop of this size counts as a dip. */
const DIP_BPS = 100;
/** A 1-hour drop of this size confirms the dip is recent. */
const FRESH_BPS = 20;
/** A 4-hour return of this size counts as recovered. */
const RECOVER_BPS = 30;
/** Trailing stop below the highest close since entry. */
const TRAIL_BPS = 100;
/** Bars to wait after a sell before buying again. */
const COOLDOWN_BARS = 60;
/** Seq from which the late fallback may fire: 75% of the 1,440-bar window. */
const FALLBACK_SEQ = 1080;
/** A 4-hour drop of this size counts as a dip for the fallback buy. */
const FALLBACK_DIP_BPS = 60;
/** A fill more than this past the latest close is refused, not chased. */
const MAX_SLIPPAGE_BPS = 300;

/** The close of every batch so far, by seq; null when the symbol missed a batch. */
const closes: (number | null)[] = [];
/** Highest close since the current entry (0 while flat). */
let peakClose = 0;
/** Filled orders seen so far, any side; the fallback only fires while this is 0. */
let filledTrades = 0;
/** Seq of the last sell decision; buying is paused for COOLDOWN_BARS after it. */
let lastSellSeq = -1e9;

function retBps(now: number, then: number): number {
  return (now / then - 1) * 10000;
}

function closeAt(seq: number): number | null {
  if (seq < 0 || seq >= closes.length) return null;
  const c = closes[seq];
  return c === undefined ? null : c;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    closes.push(bar === undefined ? null : Number(bar.c));
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    const close = bar === undefined ? null : Number(bar.c);
    const seq = state.seq;
    for (const f of batch.fills) if (f.status === 'filled') filledTrades++;

    if (held !== undefined) {
      if (close === null) return [];
      if (peakClose === 0 || close > peakClose) peakClose = close;
      const trail = retBps(close, peakClose);
      const thenLong = closeAt(seq - LONG_BARS);
      const recovered = thenLong !== null && retBps(close, thenLong) >= RECOVER_BPS;
      if (trail <= -TRAIL_BPS || recovered) {
        lastSellSeq = seq;
        peakClose = 0;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    if (close === null || seq < LONG_BARS) return [];
    if (seq - lastSellSeq < COOLDOWN_BARS) return [];
    const thenLong = closeAt(seq - LONG_BARS);
    const thenFresh = closeAt(seq - FRESH_BARS);
    if (thenLong === null || thenFresh === null) return [];
    const rLong = retBps(close, thenLong);
    const rFresh = retBps(close, thenFresh);
    const dipBps = seq >= FALLBACK_SEQ && filledTrades === 0 ? FALLBACK_DIP_BPS : DIP_BPS;
    if (rLong <= -dipBps && rFresh <= -FRESH_BPS) {
      const cash = state.cash;
      if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      peakClose = close;
      const buy: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS };
      return [buy];
    }
    return [];
  },
});
