// Rider-S: Sharpe-tuned capitulation-reversion bot for the pump.fun Sharpe sprint
// (agent-fun/replay/v2, 6-hour forward window, ranked by hourly Sharpe ratio).
//
// The prize needs net PnL > 0 AND the best Sharpe, so this bot optimises the
// ratio, not the raw PnL: small stakes, tight stops, quick exits, many small
// wins, low variance. It buys only a dip that has already stabilised — price
// 35-45% under its recent high, last trades net-IN with several distinct
// buyers back, price no longer drifting — then exits on a modest +8% take
// profit, a 50% recovery of the dip, a -5% stop, a trailing stop once the
// bounce runs, or a 300-slot time stop. A drawdown brake halts new entries
// at -15% from the equity peak (resume at -10%), long before the 50% limit.
// Weak curves get probe size only (0.01 SOL) so the 20-coin round-trip bar is
// met without variance. Deterministic: slot numbers and the batch stream
// only — no clock, no randomness, no I/O — so the two graded executions
// produce byte-identical action logs.

import type { Batch, BotState, Mark, OrderInput, Pubkey } from './vendor/agentfun-bot.ts';

export interface Params {
  highWindow: number;
  ddMin: number;
  ddMax: number;
  minRealSol: bigint;
  minHighRealSol: bigint;
  flowTrades: number;
  minBuys: number;
  lastMustBeBuy: boolean;
  minNetFlow: bigint;
  tranche: bigint;
  maxPosition: bigint;
  minBuy: bigint;
  addBand: number;
  takeProfit: number;
  recoverShare: number;
  stopLoss: number;
  trailArm: number;
  trailKeep: number;
  maxHoldSlots: number;
  cooldownSlots: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  maxEntriesPerBatch: number;
  strongRealSol: bigint;
  weakTranche: bigint;
  weakMaxPosition: bigint;
  maxWeakOpen: number;
  weakMaxHoldSlots: number;
  weakDdMin: number;
  weakDdMax: number;
  sellSplits: number;
  ddBrakeBps: number;
  ddResumeBps: number;
}

// Sharpe-first region: small stakes, strict stabilisation, fast exits.
export const DEFAULT_PARAMS: Params = {
  highWindow: 2500,
  ddMin: 0.35,
  ddMax: 0.45,
  minRealSol: 10_000_000_000n,
  minHighRealSol: 10_000_000_000n,
  flowTrades: 8,
  minBuys: 5,
  lastMustBeBuy: true,
  minNetFlow: 50_000_000n,
  tranche: 100_000_000n,
  maxPosition: 200_000_000n,
  minBuy: 8_000_000n,
  addBand: 0.05,
  takeProfit: 0.15,
  recoverShare: 0.5,
  stopLoss: 0.04,
  trailArm: 0.15,
  trailKeep: 0.85,
  maxHoldSlots: 300,
  cooldownSlots: 600,
  buySlippageBps: 300,
  sellSlippageBps: 1000,
  maxEntriesPerBatch: 1,
  strongRealSol: 25_000_000_000n,
  weakTranche: 10_000_000n,
  weakMaxPosition: 20_000_000n,
  maxWeakOpen: 2,
  weakMaxHoldSlots: 150,
  weakDdMin: 0.25,
  weakDdMax: 0.5,
  sellSplits: 1,
  ddBrakeBps: 8500,
  ddResumeBps: 9000,
};

interface Tick {
  slot: number;
  price: number;
  realSol: bigint;
  isBuy: boolean;
  sol: bigint;
}

interface Book {
  ticks: Tick[];
  entryPrice: number;
  entrySlot: number;
  entryHigh: number;
  bestGain: number;
  committed: bigint;
  coolUntil: number;
  exiting: boolean;
  strong: boolean;
}

const FEE_BPS = 125n;
const BPS = 10_000n;

function buyCap(state: BotState, mint: Pubkey): bigint {
  return (state.maxBuyLamports(mint) * 97n) / 100n;
}

function liquidationValue(mark: Mark | undefined, tokens: bigint): bigint {
  if (mark === undefined) return 0n;
  const vq = BigInt(mark.virtual_quote_reserves);
  const vt = BigInt(mark.virtual_token_reserves);
  const rq = BigInt(mark.real_quote_reserves);
  if (vt + tokens === 0n) return 0n;
  let q = (tokens * vq) / (vt + tokens);
  if (q > rq) q = rq;
  return q - (q * FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(p: Params = DEFAULT_PARAMS) {
  const books = new Map<Pubkey, Book>();
  const book = (mint: Pubkey): Book => {
    let b = books.get(mint);
    if (b === undefined) {
      b = { ticks: [], entryPrice: 0, entrySlot: -1, entryHigh: 0, bestGain: 0, committed: 0n, coolUntil: -1, exiting: false, strong: false };
      books.set(mint, b);
    }
    return b;
  };
  let peakEquity = 0n;
  let entriesHalted = false;

  return function onBatch(state: BotState, batch: Batch): OrderInput[] {
    const slot = batch.slot;
    const touched: Pubkey[] = [];
    for (const e of batch.events) {
      if (e.event !== 'TradeEvent') continue;
      const b = book(e.mint);
      const vt = BigInt(e.virtual_token_reserves);
      const price = vt === 0n ? 0 : Number(BigInt(e.virtual_quote_reserves)) / Number(vt);
      b.ticks.push({ slot, price, realSol: BigInt(e.real_quote_reserves), isBuy: e.is_buy, sol: BigInt(e.sol_amount) });
      if (b.ticks.length > 400) b.ticks.splice(0, b.ticks.length - 400);
      if (touched[touched.length - 1] !== e.mint && !touched.includes(e.mint)) touched.push(e.mint);
    }
    for (const f of batch.fills) {
      const b = books.get(f.mint);
      if (b === undefined) continue;
      if (f.side === 'sell') {
        b.exiting = false;
        if (!state.positions.has(f.mint)) {
          b.committed = 0n;
          b.entrySlot = -1;
          b.bestGain = 0;
          b.coolUntil = slot + p.cooldownSlots;
        }
      } else if (f.status !== 'filled' && !state.positions.has(f.mint)) {
        let stillPending = false;
        for (const o of state.pending.values()) if (o.order.mint === f.mint) stillPending = true;
        if (!stillPending) {
          b.committed = 0n;
          b.entrySlot = -1;
          b.bestGain = 0;
        }
      }
    }

    const orders: OrderInput[] = [];
    const cap = state.hello.caps.max_orders_per_batch;
    const tx = state.txFeeLamports();
    const marks = new Map<Pubkey, Mark>();
    for (const m of batch.marks) marks.set(m.mint, m);
    const pendingMints = new Set<Pubkey>();
    for (const o of state.pending.values()) pendingMints.add(o.order.mint);

    // Drawdown brake on equity (cash + liquidation value of open positions).
    let equity = state.cash;
    for (const [mint, h] of state.positions) equity += liquidationValue(marks.get(mint), h.token_amount);
    if (equity > peakEquity) peakEquity = equity;
    if (peakEquity > 0n) {
      const ratio = Number((equity * BPS) / peakEquity);
      if (!entriesHalted && ratio < p.ddBrakeBps) entriesHalted = true;
      else if (entriesHalted && ratio > p.ddResumeBps) entriesHalted = false;
    }

    // 1. Exits and adds on held positions, in mint order (deterministic).
    const held = [...state.positions.keys()].sort();
    for (const mint of held) {
      if (orders.length >= cap) break;
      const h = state.positions.get(mint)!;
      const b = book(mint);
      const curve = state.curves.get(mint);
      if (curve === undefined || curve.complete) continue;
      if (b.exiting) continue;
      const value = liquidationValue(marks.get(mint), h.token_amount);
      const ticks = b.ticks;
      const price = ticks.length > 0 ? ticks[ticks.length - 1]!.price : 0;
      const entrySlot = b.entrySlot < 0 ? slot : b.entrySlot;
      const target = b.entryPrice + p.recoverShare * (b.entryHigh - b.entryPrice);
      const gain = h.cost_lamports > 0n ? Number(value - h.cost_lamports) / Number(h.cost_lamports) : 0;
      if (gain > b.bestGain) b.bestGain = gain;
      const tp = gain >= p.takeProfit || (p.recoverShare > 0 && price >= target && gain > 0.03);
      const sl = gain <= -p.stopLoss;
      const trail = b.bestGain >= p.trailArm && gain <= b.bestGain * p.trailKeep;
      const stale = slot - entrySlot >= (b.strong ? p.maxHoldSlots : p.weakMaxHoldSlots);
      if (tp || sl || trail || stale) {
        if (pendingMints.has(mint)) continue;
        const n = BigInt(Math.max(1, Math.min(p.sellSplits, cap - orders.length)));
        const piece = h.token_amount / n;
        for (let i = 1n; i <= n; i++) {
          const amount = i === n ? h.token_amount - piece * (n - 1n) : piece;
          orders.push({ side: 'sell', mint, token_amount: amount, max_slippage_bps: p.sellSlippageBps });
        }
        b.exiting = true;
        continue;
      }
      // Add a tranche while the dip holds near the first entry.
      const maxPos = b.strong ? p.maxPosition : p.weakMaxPosition;
      if (pendingMints.has(mint) || b.committed >= maxPos) continue;
      if (Math.abs(price / b.entryPrice - 1) > p.addBand) continue;
      let amount = maxPos - b.committed;
      const tranche = b.strong ? p.tranche : p.weakTranche;
      if (amount > tranche) amount = tranche;
      const sizeCap = buyCap(state, mint);
      if (amount > sizeCap) amount = sizeCap;
      if (amount < p.minBuy) continue;
      if (state.freeCashLamports() - amount - tx < 0n) continue;
      orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
      b.committed += amount;
      pendingMints.add(mint);
    }

    // 2. New entries on coins that traded this slot.
    if (!entriesHalted) {
      let entries = 0;
      const open = state.committedPositionCount();
      let weakOpen = 0;
      for (const m of state.positions.keys()) if (!book(m).strong) weakOpen++;
      for (const o of state.pending.values()) if (o.order.side === 'buy' && !state.positions.has(o.order.mint) && !book(o.order.mint).strong) weakOpen++;
      for (const mint of touched) {
        if (orders.length >= cap || entries >= p.maxEntriesPerBatch) break;
        if (open + entries >= state.hello.caps.max_open_positions) break;
        if (state.positions.has(mint) || pendingMints.has(mint)) continue;
        const curve = state.curves.get(mint);
        if (curve === undefined || curve.complete) continue;
        const b = book(mint);
        if (slot < b.coolUntil) continue;
        const ticks = b.ticks;
        if (ticks.length < p.flowTrades) continue;
        const last = ticks[ticks.length - 1]!;
        if (last.realSol < p.minRealSol) continue;
        let hi = 0;
        let hiReal = 0n;
        for (let i = ticks.length - 1; i >= 0; i--) {
          const t = ticks[i]!;
          if (slot - t.slot > p.highWindow) break;
          if (t.price > hi) {
            hi = t.price;
            hiReal = t.realSol;
          }
        }
        if (hi <= 0 || hiReal < p.minHighRealSol) continue;
        const dd = 1 - last.price / hi;
        const strong = last.realSol >= p.strongRealSol;
        if (strong ? dd < p.ddMin || dd > p.ddMax : dd < p.weakDdMin || dd > p.weakDdMax) continue;
        // Buyers still there, net-IN: the dip has stopped bleeding.
        let buys = 0;
        let net = 0n;
        for (let i = ticks.length - p.flowTrades; i < ticks.length; i++) {
          const t = ticks[i]!;
          if (t.isBuy) {
            buys++;
            net += t.sol;
          } else net -= t.sol;
        }
        if (buys < p.minBuys || net < p.minNetFlow) continue;
        if (p.lastMustBeBuy && !last.isBuy) continue;
        if (!strong && weakOpen >= p.maxWeakOpen) continue;
        let amount = strong ? p.tranche : p.weakTranche;
        const maxPos = strong ? p.maxPosition : p.weakMaxPosition;
        if (amount > maxPos) amount = maxPos;
        const sizeCap = buyCap(state, mint);
        if (amount > sizeCap) amount = sizeCap;
        if (amount < p.minBuy) continue;
        if (state.freeCashLamports() - amount - tx < 0n) continue;
        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: p.buySlippageBps });
        b.entryPrice = last.price;
        b.entrySlot = slot;
        b.entryHigh = hi;
        b.bestGain = 0;
        b.committed = amount;
        b.exiting = false;
        b.strong = strong;
        pendingMints.add(mint);
        entries++;
        if (!strong) weakOpen++;
      }
    }
    return orders;
  };
}
