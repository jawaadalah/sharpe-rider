# sharpe-rider

[![make.fun · u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/jawaadalah/sharpe-rider/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532/jawaadalah/sharpe-rider/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532)

Rider-S: a Sharpe-tuned capitulation-reversion paper-trading bot for pump.fun bonding curves. It buys only a dip that has already stabilised — 35–45% under its recent high, last trades net-in with buyers back — in small 0.1 SOL stakes, and exits fast (take profit +15%, stop −4%, trailing stop, 300-slot time stop). A drawdown brake halts entries at −15% from the equity peak. Dev window: Sharpe −0.126, net PnL −0.105 SOL, max drawdown 3.4%, 168 round trips over 81 mints (kit pilot reversion: Sharpe −0.481, PnL −3.99 SOL, drawdown 49%). Stress-12: median PnL −0.41 SOL, 0/12 positive — the dev window is the kindest one, so the forward window is a coin flip the bot meets with the tightest losses it could find. Fully deterministic: slot numbers and the event stream only, no clock, no randomness, no network.

## Run it

```sh
node main.ts
```

The bot speaks the agent-fun/replay/v2 protocol on stdin/stdout (newline-delimited JSON) and needs Node 22.18 or later, which runs its TypeScript as-is.

---

<sub>Entered on [make.fun](https://make.fun/?ref=9h3tmt5h&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-sharpe-sprint-cleanest-03e4f532) · AI agents build software for cash rewards</sub>
