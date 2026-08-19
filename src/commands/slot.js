const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const { getBalance, debit, credit } = require("../modules/slot-wallet.module");
const logger = require("../logger");
const { getPoolBalance, addToPool, subtractFromPool } = require("../modules/pool.module");
const { getOwnerSettings } = require("../modules/owner-settings.module");
const { isOwner } = require("../modules/owner.module");

const activeSpins = new Set();
const lastSpinTime = new Map();

// ─── WLJ CONFIG ──────────────────────────────────────────────────────────────
// Defaults — owner can change at runtime via /wlj command
const DEFAULT_WIN       = 37;   // base win % above the $2,000 pool threshold
const DEFAULT_JACKPOT   = 0.1;  // 4-diamond jackpot %
// Lose% is always derived: 100 - win - jackpot

// Streak adjustment defaults
const DEFAULT_BOOST     = 5;    // +5 Win% after 3+ consecutive losses
const DEFAULT_REDUCE    = 10;   // -Win% after 2+ consec. wins
const DEFAULT_MAX_WIN   = 42;
const DEFAULT_MIN_WIN   = 37;

// Pool safety: below $5,000, reduce Win%; above it, recover gradually.
// Values are stored in cents throughout the bot.
const POOL_SAFETY_THRESHOLD = 200000; // $2,000 reserve floor
const POOL_RECOVERY_START = 200000; // normal odds start above $2,000
const POOL_RECOVERY_BAND_END = 200000; // no gradual band below the threshold
const POOL_RATE_RECOVERY_TARGET = 200000; // base rate applies once the threshold is crossed
const POOL_SAFETY_MIN_WIN = 0; // below reserve: all normal-user wins are blocked
const LOW_POOL_NORMAL_WIN = 0;
const RECOVERY_STEP = 5;
const MAX_RECOVERY_BOOSTS = 2;

// Runtime globals (owner-adjustable)
const getCfg = () => ({
  win:      global.slotWin      ?? DEFAULT_WIN,
  jackpot:  global.slotJackpot  ?? DEFAULT_JACKPOT,
  boost:    global.slotBoost    ?? DEFAULT_BOOST,
  reduce:   global.slotReduce   ?? DEFAULT_REDUCE,
  maxWin:   global.slotMaxWin   ?? DEFAULT_MAX_WIN,
  minWin:   global.slotMinWin   ?? DEFAULT_MIN_WIN,
});

// Payout multipliers
const MULTI_2KIND    = 2;    // 2-of-a-kind → 2x
const MULTI_3KIND    = 3;    // 3-of-a-kind → 3x
const MULTI_4KIND    = 4;    // 4-of-a-kind (non-diamond) → 4x
const MULTI_JACKPOT  = 5;    // 4 💎 → 5x

// Per-user history (in-memory, last 5 spins)
const userHistory = new Map(); // userId → ['W','L','W',...]
const recoveryState = new Map(); // userId → { attempts: number, exhausted: boolean }
const HISTORY_SIZE = 5;

// ─── WLJ RATE CALCULATOR ─────────────────────────────────────────────────────
const getWLJ = (userId, poolBalance = POOL_RATE_RECOVERY_TARGET) => {
  const hist = userHistory.get(userId) || [];
  const cfg  = getCfg();

  const balance = Number(poolBalance);
  if (balance < POOL_RECOVERY_START) {
    recoveryState.delete(userId);
    return { W: LOW_POOL_NORMAL_WIN, L: 100, J: 0 };
  }

  // Above $2,000, use 37% normally. After a loss, add +5% for the next
  // round; a win records "W", so the boost disappears immediately.
  let winRate = Math.min(cfg.maxWin, cfg.win);
  const hasPreviousLoss = hist.length > 0 && hist[hist.length - 1] === "L";
  if (hasPreviousLoss) winRate = Math.min(winRate + cfg.boost, cfg.maxWin);

  const loseRate = Math.max(0, 100 - cfg.jackpot - winRate);
  return { W: winRate, L: loseRate, J: cfg.jackpot };
};

// ─── RECORD RESULT ───────────────────────────────────────────────────────────
const recordResult = (userId, result, poolBalance) => {
  const hist = userHistory.get(userId) || [];
  hist.push(result);
  if (hist.length > HISTORY_SIZE) hist.shift();
  userHistory.set(userId, hist);

  if (Number(poolBalance) < POOL_RECOVERY_START || Number(poolBalance) >= POOL_RECOVERY_BAND_END) {
    recoveryState.delete(userId);
    return;
  }

  if (result === "W") {
    recoveryState.delete(userId);
    return;
  }

  const state = recoveryState.get(userId) || { attempts: 0, exhausted: false };
  const hasLossStreak = hist.length >= 3 && hist.slice(-3).every(r => r === "L");
  if (!state.exhausted && hasLossStreak) {
    state.attempts += 1;
    if (state.attempts >= MAX_RECOVERY_BOOSTS) state.exhausted = true;
    recoveryState.set(userId, state);
  }
};

// ─── SLOT HANDLER ────────────────────────────────────────────────────────────
const slotHandler = async (ctx) => {
  const userId = ctx.from.id;
  let betAmount = 0;
  let waitMsg = null;
  let debited = false;
  let creditedWin = false;
  let settled = false;
  try {
    const text = ctx.message.text || "";

    if (activeSpins.has(userId)) {
      return ctx.reply("Please wait for your current spin to finish!").catch(() => {});
    }

    const ownerId = process.env.OWNER_ID;
    let ownerSettings;
    try {
      ownerSettings = await getOwnerSettings();
    } catch (settingsError) {
      logger.error(`Slot settings error: ${settingsError.message}`);
      ownerSettings = { winRate: DEFAULT_WIN, minBet: 500, maxBet: 25000, cooldown: 8000, pauseSlot: false };
    }
    if (ownerSettings.pauseSlot && !isOwner(ctx)) {
      return ctx.reply("🛠 Slot game is temporarily paused by owner.").catch(() => {});
    }

    const now = Date.now();
    if (!isOwner(ctx) && lastSpinTime.has(userId)) {
      const timeLeft = Math.ceil((lastSpinTime.get(userId) + ownerSettings.cooldown - now) / 1000);
      if (timeLeft > 0) {
        return ctx.reply(`⏳ Please wait ${timeLeft} seconds before spinning again!`).catch(() => {});
      }
    }

    const args = text.split(" ");
    betAmount = args[1] ? Math.floor(parseFloat(args[1]) * 100) : 0;

    if (isNaN(betAmount) || betAmount <= 0) {
      return ctx.reply("Usage: /slot <amount_in_dollars>\nExample: /slot 1.5");
    }
    if (betAmount < ownerSettings.minBet) {
      return ctx.reply(`🔴 အနည်းဆုံး ${(ownerSettings.minBet / 100).toFixed(2)} $ လောင်းရပါမည်။`);
    }
    if (betAmount > ownerSettings.maxBet) {
      return ctx.reply(`🔴 အများဆုံး ${(ownerSettings.maxBet / 100).toFixed(2)} $ ထိသာ လောင်းနိုင်ပါသည်။`);
    }

    // Reserve this user before any async work so duplicate spins cannot overlap.
    activeSpins.add(userId);

    // Acknowledge immediately; database work happens after the fast Telegram reply.
    waitMsg = await ctx.reply("⚡️", { reply_to_message_id: ctx.message.message_id });

    const remainingBalance = await debit(userId, betAmount);

    if (remainingBalance === null) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        null,
        getString("NO_BALANCE")
      ).catch(err => logger.error("Balance message error: " + err.message));
      activeSpins.delete(userId);
      return;
    }

    debited = true;
    lastSpinTime.set(userId, Date.now());

    const _usd = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const getDesign = (s1, s2, s3, s4, bet = 0, win = 0, profit = 0, status = "") => {
      const resultStatus = profit > 0 ? "Win ✅" : "Lose ❌";
      return `🎰 GUESS SLOT V2.0
✦ ━━━━━━━━━━━ ✦

┏━━━━━━━━━━━━━┓
┃ ${s1} | ${s2} | ${s3} | ${s4} ┃
┗━━━━━━━━━━━━━┛

✦ ━━━━━━━━━━━ ✦
🎰 SLOT DETAILS
✦ ━━━━━━━━━━━ ✦
💵 Bet     : ${_usd(bet)}
💰 Win     : ${_usd(win)}
📊 Profit  : ${_usd(profit)} [${resultStatus}]
✦ ━━━━━━━━━━━ ✦`;
    };

    const slots      = ["🍒", "🍎", "🍐", "🍉", "🍊", "🍌", "🍇", "🍓", "🫐", "🍈", "🍍", "🥭", "🍑", "🥝"];
    const DIAMOND    = "💎";
    const makeLoseSymbols = () => {
      const shuffled = [...slots].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, 4);
    };

    // ─── Determine outcome via WLJ ─────────────────────────────────────────
    const poolBalance = await getPoolBalance();
    // Keep the existing WLJ algorithm but apply the persisted owner base win rate.
    global.slotWin = ownerSettings.winRate;
    const wlj    = getWLJ(userId, poolBalance);
    let random = Math.random() * 100;

    let result1, result2, result3, result4;
    let winMultiplier = 0;
    let status        = "Lose";
    let outcome       = "L";


    if (random < wlj.J) {
      // ── JACKPOT: 4 diamonds → 5x ─────────────────────────────────────────
      result1 = result2 = result3 = result4 = DIAMOND;
      winMultiplier = MULTI_JACKPOT;
      status  = `💎 Jackpot! (${MULTI_JACKPOT}x)`;
      outcome = "W";

    } else if (random < wlj.J + wlj.W) {
      // ── WIN: pick sub-type ────────────────────────────────────────────────
      const winRoll = Math.random() * 100;
      outcome = "W";

      if (winRoll < 10) {
        // 4-of-a-kind (fruit) → 4x
        const sym = slots[Math.floor(Math.random() * slots.length)];
        result1 = result2 = result3 = result4 = sym;
        winMultiplier = MULTI_4KIND;
        status  = `🍀 4တန်းတူ! (${MULTI_4KIND}x)`;

      } else if (winRoll < 40) {
        // 3-of-a-kind → 3x
        const sym = slots[Math.floor(Math.random() * slots.length)];
        result1 = result2 = result3 = sym;
        let other;
        do { other = slots[Math.floor(Math.random() * slots.length)]; } while (other === sym);
        result4 = other;
        winMultiplier = MULTI_3KIND;
        status  = `🎯 3တန်းတူ! (${MULTI_3KIND}x)`;

      } else {
        // 2-of-a-kind → 2x  (most common win)
        const sym = slots[Math.floor(Math.random() * slots.length)];
        result1 = result2 = sym;
        let o1, o2;
        do { o1 = slots[Math.floor(Math.random() * slots.length)]; } while (o1 === sym);
        do { o2 = slots[Math.floor(Math.random() * slots.length)]; } while (o2 === sym || o2 === o1);
        result3 = o1;
        result4  = o2;
        winMultiplier = MULTI_2KIND;
        status  = `✌️ 2တန်းတူ! (${MULTI_2KIND}x)`;
      }

    } else {
      // ── LOSE ──────────────────────────────────────────────────────────────
      [result1, result2, result3, result4] = makeLoseSymbols();
      winMultiplier = 0;
      status  = "Lose ❌";
      outcome = "L";
    }

    // Protect the reserve at settlement: a non-owner win may not lower the pool below $5,000.
    const potentialWinAmount = betAmount * winMultiplier;
    const potentialProfit = potentialWinAmount - betAmount;
    const reserveBreach = !isOwner(ctx) && (
      poolBalance < POOL_SAFETY_THRESHOLD ||
      (potentialProfit > 0 && poolBalance - potentialProfit < POOL_SAFETY_THRESHOLD)
    );
    if (reserveBreach && outcome === "W") {
      [result1, result2, result3, result4] = makeLoseSymbols();
      winMultiplier = 0;
      status = "Lose ❌";
      outcome = "L";
    }

    // ─── Record outcome for next spin's WLJ adjustment ─────────────────────
    recordResult(userId, outcome, poolBalance);

    // ─── Settle balance ────────────────────────────────────────────────────
    const winAmount = betAmount * winMultiplier;
    const profit    = winAmount - betAmount;

    if (winAmount > 0) {
      await credit(userId, winAmount);
      creditedWin = true;
      // Subtract profit from pool (since user won)
      if (profit > 0) {
        await subtractFromPool(profit);
      }
    } else {
      // User lost, add the bet amount to the pool
      await addToPool(betAmount);
      await increaseBankAmount({ ctx, increaseAmount: betAmount }).catch(err =>
        logger.error("Bank update error: " + err.message)
      );
    }
    settled = true;

    // Show the final result immediately after settlement; no artificial delay.
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        null,
        getDesign(result1, result2, result3, result4, betAmount, winAmount, profit, status)
      ).catch(err => logger.error("Edit result error: " + err.message));
    } finally {
      activeSpins.delete(userId);
    }

  } catch (err) {
    logger.error("Slot handler error: " + err.stack);

    // Refund only when the bet was deducted but no user win was credited.
    if (debited && !creditedWin && !settled) {
      await credit(userId, betAmount).catch(refundErr => logger.error("Slot refund error: " + refundErr.message));
    }

    activeSpins.delete(userId);
    if (waitMsg) {
      return ctx.telegram.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        null,
        getString("DATABASE_LOCK")
      ).catch(() => {});
    }
    return ctx.reply(getString("DATABASE_LOCK")).catch(() => {});
  }
};

// ─── /wlj command — owner only ───────────────────────────────────────────────
//
//  View current settings:
//    /wlj
//
//  Change base rates (win + jackpot must be < 100; lose = 100 - win - jackpot):
//    /wlj win <1-80>
//    /wlj jackpot <1-10>
//
//  Change streak adjustments:
//    /wlj boost <1-30>    ← how much Win% rises after 3 consec. losses
//    /wlj reduce <1-30>   ← how much Win% drops after 2 consec. wins
//    /wlj maxwin <1-80>   ← ceiling Win% after boost
//    /wlj minwin <1-80>   ← floor Win% after reduce
//
//  Reset everything to defaults:
//    /wlj reset
//
const wljHandler = async (ctx) => {
  if (!isOwner(ctx)) return;

  const args   = (ctx.message.text || "").trim().split(/\s+/);
  const sub    = args[1]?.toLowerCase();
  const val    = parseFloat(args[2]);
  const cfg    = getCfg();

  // ── RESET ─────────────────────────────────────────────────────────────────
  if (sub === "reset") {
    global.slotWin = global.slotJackpot = global.slotBoost =
    global.slotReduce = global.slotMaxWin = global.slotMinWin = undefined;
    return ctx.reply(`♻️ WLJ settings reset to defaults.\n\nWin: ${DEFAULT_WIN}% | Lose: ${100 - DEFAULT_WIN - DEFAULT_JACKPOT}% | 💎: ${DEFAULT_JACKPOT}%`);
  }

  // ── SETTER ────────────────────────────────────────────────────────────────
  if (sub && !isNaN(val)) {
    const int = Math.round(val);
    const numeric = Math.round(val * 10) / 10;
    let error = null;

    if (sub === "win") {
      if (int < 1 || int > 80) error = "Win% must be 1–80";
      else if (int + cfg.jackpot >= 100) error = `Win + Jackpot (${cfg.jackpot}%) must be < 100`;
      else { global.slotWin = int; }

    } else if (sub === "jackpot") {
      if (numeric < 0.1 || numeric > 10) error = "Jackpot% must be 0.1–10";
      else if (cfg.win + numeric >= 100) error = `Win (${cfg.win}%) + Jackpot must be < 100`;
      else { global.slotJackpot = numeric; }

    } else if (sub === "boost") {
      if (int < 1 || int > 30) error = "Boost must be 1–30";
      else { global.slotBoost = int; }

    } else if (sub === "reduce") {
      if (int < 1 || int > 30) error = "Reduce must be 1–30";
      else { global.slotReduce = int; }

    } else if (sub === "maxwin") {
      if (int < 1 || int > 80) error = "MaxWin must be 1–80";
      else { global.slotMaxWin = int; }

    } else if (sub === "minwin") {
      if (int < 1 || int > 80) error = "MinWin must be 1–80";
      else { global.slotMinWin = int; }

    } else {
      error = `Unknown setting "${sub}"`;
    }

    if (error) return ctx.reply(`❌ ${error}`);

    const nc = getCfg();
    return ctx.reply(
      `✅ slotWin rate updated!\n\n` +
      `📊 Win: ${nc.win}% | Lose: ${100 - nc.win - nc.jackpot}% | 💎: ${nc.jackpot}%\n` +
      `🔄 Boost: +${nc.boost}% (max ${nc.maxWin}%) | Reduce: -${nc.reduce}% (min ${nc.minWin}%)`
    );
  }

  // ── STATUS VIEW ───────────────────────────────────────────────────────────
  const lose = 100 - cfg.win - cfg.jackpot;
  const lines = [
    `🎰 Slot WLJ Settings`,
    ``,
    `📊 Base Rates`,
    `   Win  : ${cfg.win}%`,
    `   Pool safety: below $${(POOL_SAFETY_THRESHOLD / 100).toFixed(0)} scales Win% toward ${POOL_SAFETY_MIN_WIN}%`,
    `   Recovery: Win% rises gradually until $${(POOL_RATE_RECOVERY_TARGET / 100).toFixed(0)} pool`,
    `   Lose : ${lose}%`,
    `   💎   : ${cfg.jackpot}% (${MULTI_JACKPOT}x)`,
    ``,
    `🔄 Streak Adjustments`,
    `   3+ consec. Lose → +${cfg.boost}% Win (ceil ${cfg.maxWin}%)`,
    `   2+ consec. Win  → -${cfg.reduce}% Win (floor ${cfg.minWin}%)`,
    ``,
    `🏆 Payouts`,
    `   2-of-a-kind : ${MULTI_2KIND}x`,
    `   3-of-a-kind : ${MULTI_3KIND}x`,
    `   4-of-a-kind : ${MULTI_4KIND}x`,
    `   4 💎        : ${MULTI_JACKPOT}x`,
    ``,
    `👥 Tracked users: ${userHistory.size}`,
    ``,
    `📝 Commands`,
    `   /wlj win <num>      — Win base %`,
    `   /wlj jackpot <num>  — 💎 chance %`,
    `   /wlj boost <num>    — streak loss boost`,
    `   /wlj reduce <num>   — streak win reduce`,
    `   /wlj maxwin <num>   — max Win% ceiling`,
    `   /wlj minwin <num>   — min Win% floor`,
    `   /wlj reset          — restore defaults`,
  ];

  return ctx.reply(lines.join("\n"));
};

const composer = new Composer();
composer.command(getCommandName("slot"), slotHandler);
composer.command("wlj", wljHandler);
composer.hears(/^\.slot(\s+.*)?$/, slotHandler);

module.exports = composer;
