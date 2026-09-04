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
const DEFAULT_BOOST     = 15;   // +15 Win% after 3 consecutive losses
const DEFAULT_REDUCE    = 10;   // -Win% after 2+ consec. wins
const DEFAULT_MAX_WIN   = 52;
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
const MULTI_JACKPOT  = 8;    // 777 → 8x

// Per-user history (in-memory, last 5 spins)
const userHistory = new Map(); // userId → ['W','L','W',...]
const recoveryState = new Map(); // userId → { attempts: number, exhausted: boolean }
const HISTORY_SIZE = 5;
const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐"];
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// Telegram's 🎰 value is made from three 2-bit reel values. Value 64 is 777.
const getTelegramSlotResult = (value) => {
  const numericValue = Number(value);
  if (numericValue === 64) {
    return { symbols: ["7️⃣", "7️⃣", "7️⃣"], multiplier: MULTI_JACKPOT, status: `${MULTI_JACKPOT}X` };
  }

  const map = [1, 2, 3, 0];
  const symbols = [0, 2, 4].map((shift) => SLOT_SYMBOLS[map[(numericValue - 1 >> shift) & 3]]);
  const counts = symbols.reduce((result, symbol) => {
    result[symbol] = (result[symbol] || 0) + 1;
    return result;
  }, {});
  const highestCount = Math.max(...Object.values(counts));
  // No matching reels means a full loss: no payout and the bet remains lost.
  const multiplier = highestCount === 3 ? MULTI_3KIND : highestCount === 2 ? MULTI_2KIND : 0;
  return {
    symbols,
    multiplier,
    status: multiplier > 0 ? `${multiplier}X` : "Lose",
  };
};

// ─── WLJ RATE CALCULATOR ─────────────────────────────────────────────────────
const getWLJ = (userId, poolBalance = POOL_RATE_RECOVERY_TARGET) => {
  const hist = userHistory.get(userId) || [];
  const cfg  = getCfg();

  const balance = Number(poolBalance);
  if (balance < POOL_RECOVERY_START) {
    recoveryState.delete(userId);
    return { W: LOW_POOL_NORMAL_WIN, L: 100, J: 0 };
  }

  // Above $2,000, use the normal rate. After exactly three consecutive
  // losses, add the configured boost to the next round; a win resets it.
  let winRate = Math.min(cfg.maxWin, cfg.win);
  const hasThreeLosses = hist.length >= 3 && hist.slice(-3).every((result) => result === "L");
  if (hasThreeLosses) winRate = Math.min(winRate + cfg.boost, cfg.maxWin);

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

    // Send Telegram's native animated slot as a reply to the bet command.
    // The returned dice.value is the source of truth for the displayed result.
    waitMsg = await ctx.telegram.sendDice(ctx.chat.id, {
      emoji: "🎰",
      reply_to_message_id: ctx.message.message_id,
    });

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
    const mention = `<a href="tg://user?id=${userId}">${escapeHtml(ctx.from.first_name || "User")}</a>`;
    const getDesign = (bet = 0, win = 0, profit = 0, status = "") => {
      const resultStatus = win > 0 ? "Win ✅" : "Lose ❌";
      const resultLine = win > 0
        ? `🎰Win - ${_usd(win)} [${status}]`
        : `🎰Lose - ${_usd(bet)}`;
      return `🎰 GUESS SLOT V2.0
User - ${mention}

🎰 SLOT DETAILS

💵 Bet     : ${_usd(bet)}
${resultLine}
📊 Profit  : ${_usd(profit)} [${resultStatus}]
✦ ━━━━━━━━━━━ ✦`;
    };

    // Telegram's returned 🎰 value is the source of truth for both the result
    // shown to the user and the payout multiplier.
    const diceValue = Number(waitMsg.dice?.value);
    if (!Number.isInteger(diceValue) || diceValue < 1 || diceValue > 64) {
      throw new Error("Telegram slot result value is missing or invalid");
    }
    const telegramResult = getTelegramSlotResult(diceValue);
    const [result1, result2, result3] = telegramResult.symbols;
    const winMultiplier = telegramResult.multiplier;
    const status = telegramResult.status;
    const outcome = winMultiplier > 0 ? "W" : "L";
    const poolBalance = await getPoolBalance();

    // Keep the existing history tracking for /wlj statistics.
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

    // Keep the animated 🎰 message intact and send the result as its reply.
    try {
      await ctx.telegram.sendMessage(
        ctx.chat.id,
        getDesign(betAmount, winAmount, profit, status),
        {
          parse_mode: "HTML",
          reply_to_message_id: waitMsg.message_id,
        },
      );
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
    `   777  : ${cfg.jackpot}% (${MULTI_JACKPOT}x)`,
    ``,
    `🔄 Streak Adjustments`,
    `   3 consec. Lose → +${cfg.boost}% Win (ceil ${cfg.maxWin}%)`,
    `   2+ consec. Win  → -${cfg.reduce}% Win (floor ${cfg.minWin}%)`,
    ``,
    `🏆 Payouts`,
    `   2-of-a-kind : ${MULTI_2KIND}x`,
    `   3-of-a-kind : ${MULTI_3KIND}x`,
    `   777         : ${MULTI_JACKPOT}x`,
    ``,
    `👥 Tracked users: ${userHistory.size}`,
    ``,
    `📝 Commands`,
    `   /wlj win <num>      — Win base %`,
    `   /wlj jackpot <num>  — 777 chance %`,
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
