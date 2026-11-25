// Rider-S: Sharpe-tuned capitulation-reversion bot for the pump.fun Sharpe sprint.
// Run by the grader as `node /bot/main.ts`; the strategy lives in strategy.ts
// and the protocol shim is the kit's SDK, vendored byte for byte in vendor/.
// Tuned on the dev window (TP +15% / SL -4%, stabilised-dip entries, 0.1 SOL
// stakes): Sharpe -0.126, PnL -0.105 SOL, max DD 3.4%, 168 round trips.

import { runBot } from './vendor/agentfun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const onBatch = createStrategy(DEFAULT_PARAMS);

await runBot({ onBatch });
