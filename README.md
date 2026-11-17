# Dip-buyer: a mean-reversion BTC trading bot

Trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars, long only,
with $1,000 of paper money. It buys only deep, fresh dips and sells on
recovery or a trailing stop.

## Strategy in plain words

The dev window showed that 1-minute cbBTC is choppy and strongly
mean-reverting over 1–4 hours: a 4-hour drop of 100 bps or more is typically
followed by a recovery, while sharp rallies fade. A full round trip costs
about 35 bps (fees, slippage, pool impact), so trend-following on 1-minute
bars just bleeds — every whipsaw costs more than the moves it catches.

This bot therefore trades rarely, only when the expected recovery clearly
exceeds the cost:

- **Buy** (all cash) when the close is at least 100 bps below its close 240
  bars (4 hours) ago **and** at least 20 bps below its close 60 bars ago —
  the dip is deep and still fresh.
- **Sell** (whole position) when the 4-hour return turns positive again
  (recovered 30 bps above the 4-hour-ago close), or when the close falls
  100 bps below the highest close since entry (trailing stop).
- After any sell it waits 60 bars before buying again, so it cannot chase a
  falling knife bar after bar.

## Dev-window result (local grade)

Net PnL **+$14.80** on the frozen 24-hour dev window, 6 trades (3 round
trips), max drawdown 0.66% — comfortably above the $0 dev gate, with the win
split across both halves of the window (+$9.45 / +$6.00). The thresholds sit
in the middle of a broad plateau (dip 90–110 bps, stop 80–120 bps, recovery
15–50 bps all clear +$13 to +$16), and the result survives doubling the
modelled price impact (+$7.85), so it is a property of the market's shape
rather than one fitted number.

## Files

- `main.ts` — the bot (Node 22, standard library only, fully deterministic:
  no clock, no network, no randomness).
- `vendor/makefun-bars.ts` — byte-for-byte copy of the kit's
  agent-fun/bars-replay/v1 shim.
- `README.md` — this file.
- `LICENSE` — MIT.
