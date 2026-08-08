const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const activeSpins = new Set();

// ─── WLJ CONFIG ──────────────────────────────────────────────────────────────
// Defaults — owner can change at runtime via /wlj command
const DEFAULT_WIN       = 36;   // base win %
const DEFAULT_JACKPOT   = 2;    // 4-diamond jackpot %
// Lose% is always derived: 100 - win - jackpot

// Streak adjustment defaults
const DEFAULT_BOOST     = 15;   // +Win% after 3+ consec. losses
const DEFAULT_REDUCE    = 10;   // -Win% after 2+ consec. wins
const DEFAULT_MAX_WIN   = 55;
const DEFAULT_MIN_WIN   = 20;

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
const HISTORY_SIZE = 5;

// ─── WLJ RATE CALCULATOR ─────────────────────────────────────────────────────
const getWLJ = (userId) => {
  const hist = userHistory.get(userId) || [];
  const cfg  = getCfg();

  let winRate = cfg.win;

  if (hist.length >= 3 && hist.slice(-3).every(r => r === "L")) {
    // 3+ consecutive losses → boost win chance
    winRate = Math.min(winRate + cfg.boost, cfg.maxWin);
  } else if (hist.length >= 2 && hist.slice(-2).every(r => r === "W")) {
    // 2+ consecutive wins → reduce win chance
    winRate = Math.max(winRate - cfg.reduce, cfg.minWin);
  }

  const loseRate = 100 - cfg.jackpot - winRate;

  return { W: winRate, L: loseRate, J: cfg.jackpot };
};

// ─── RECORD RESULT ───────────────────────────────────────────────────────────
const recordResult = (userId, result) => {
  const hist = userHistory.get(userId) || [];
  hist.push(result);
  if (hist.length > HISTORY_SIZE) hist.shift();
  userHistory.set(userId, hist);
};

// ─── SLOT HANDLER ────────────────────────────────────────────────────────────
const slotHandler = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const text = ctx.message.text || "";

    if (activeSpins.has(userId)) {
      return ctx.reply("Please wait for your current spin to finish!").catch(() => {});
    }

    const args = text.split(" ");
    const betAmount = args[1] ? Math.floor(parseFloat(args[1]) * 100) : 100;

    if (isNaN(betAmount) || betAmount <= 0) {
      return ctx.reply("Usage: /slot <amount_in_dollars>\nExample: /slot 1.5");
    }
    if (betAmount < 10) {
      return ctx.reply("🔴 အနည်းဆုံး 0.10 $ လောင်းရပါမည်။");
    }
    if (betAmount > 1000000) {
      return ctx.reply("🔴 အများဆုံး 10,000 $ ထိသာ လောင်းနိုင်ပါသည်။");
    }

    const user = await User.findOneAndUpdate(
      { id: userId, coins: { $gte: betAmount } },
      { $inc: { coins: -betAmount } },
      { new: true }
    );

    if (!user) {
      return ctx.reply(getString("NO_BALANCE"));
    }

    activeSpins.add(userId);

    const waitMsg = await ctx.reply("⚡️", { reply_to_message_id: ctx.message.message_id });

    const _usd = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const getDesign = (s1, s2, s3, s4, bet = 0, win = 0, profit = 0, status = "") =>
      `🎰 GUESS SLOT V2.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━━━┓\n┃ ${s1} | ${s2} | ${s3} | ${s4} ┃\n┗━━━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${_usd(bet)}\n💰 Win     : ${_usd(win)}\n📊 Profit  : ${_usd(profit)} [${status}]\n✦ ━━━━━━━━━━━ ✦`;

    const slots      = ["🍒", "🍎", "🍐", "🍉", "🍊", "🍌", "🍇", "🍓", "🫐", "🍈", "🍍", "🥭", "🍑", "🥝"];
    const DIAMOND    = "💎";

    // ─── Determine outcome via WLJ ─────────────────────────────────────────
    const wlj    = getWLJ(userId);
    const random = Math.random() * 100;

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
      // Guarantee all 4 are different (no accidental matches)
      const shuffled = [...slots].sort(() => 0.5 - Math.random());
      result1 = shuffled[0];
      result2 = shuffled[1];
      result3 = shuffled[2];
      result4 = shuffled[3];
      winMultiplier = 0;
      status  = "Lose ❌";
      outcome = "L";
    }

    // ─── Record outcome for next spin's WLJ adjustment ─────────────────────
    recordResult(userId, outcome);

    // ─── Settle balance ────────────────────────────────────────────────────
    const winAmount = betAmount * winMultiplier;
    const profit    = winAmount - betAmount;

    if (winAmount > 0) {
      await User.findOneAndUpdate(
        { id: userId },
        { $inc: { coins: winAmount } }
      );
    } else {
      await increaseBankAmount({ ctx, increaseAmount: betAmount }).catch(err =>
        logger.error("Bank update error: " + err.message)
      );
    }

    setTimeout(async () => {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          waitMsg.message_id,
          null,
          getDesign(result1, result2, result3, result4, betAmount, winAmount, profit, status)
        ).catch(err => logger.error("Edit result error: " + err.message));
      } catch (err) {
        logger.error("Timeout result error: " + err.message);
      } finally {
        activeSpins.delete(userId);
      }
    }, 1500);

  } catch (err) {
    logger.error("Slot handler error: " + err.stack);
    activeSpins.delete(userId);
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
  const ownerId = process.env.OWNER_ID;
  if (!ownerId || ctx.from.id.toString() !== ownerId) return;

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
    let error = null;

    if (sub === "win") {
      if (int < 1 || int > 80) error = "Win% must be 1–80";
      else if (int + cfg.jackpot >= 100) error = `Win + Jackpot (${cfg.jackpot}%) must be < 100`;
      else { global.slotWin = int; }

    } else if (sub === "jackpot") {
      if (int < 1 || int > 10) error = "Jackpot% must be 1–10";
      else if (cfg.win + int >= 100) error = `Win (${cfg.win}%) + Jackpot must be < 100`;
      else { global.slotJackpot = int; }

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
