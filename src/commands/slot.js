const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const activeSpins = new Set();

// ─── WLJ CONFIG ──────────────────────────────────────────────────────────────
// Base rates (%) — must sum to 100
const BASE_WIN       = 36;   // normal wins
const BASE_JACKPOT   = 2;    // 4 diamonds
const BASE_LOSE      = 62;   // loss

// Streak adjustments
const BOOST_WIN_ON_LOSS_STREAK  = 15;  // added to Win% after 3+ consec. losses
const REDUCE_WIN_ON_WIN_STREAK  = 10;  // subtracted from Win% after 2+ consec. wins

const MAX_WIN_RATE   = 55;
const MIN_WIN_RATE   = 20;

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

  let winRate = BASE_WIN;

  if (hist.length >= 3 && hist.slice(-3).every(r => r === "L")) {
    // 3+ consecutive losses → boost win chance
    winRate = Math.min(winRate + BOOST_WIN_ON_LOSS_STREAK, MAX_WIN_RATE);
  } else if (hist.length >= 2 && hist.slice(-2).every(r => r === "W")) {
    // 2+ consecutive wins → reduce win chance
    winRate = Math.max(winRate - REDUCE_WIN_ON_WIN_STREAK, MIN_WIN_RATE);
  }

  const loseRate = 100 - BASE_JACKPOT - winRate;

  return { W: winRate, L: loseRate, J: BASE_JACKPOT };
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
    const betAmount = args[1] ? parseInt(args[1]) : 1000;

    if (isNaN(betAmount)) {
      return ctx.reply("Usage: /slot <amount>");
    }
    if (betAmount < 500) {
      return ctx.reply("🔴 အနည်းဆုံး 500 MMK လောင်းရပါမည်။");
    }
    if (betAmount > 25000) {
      return ctx.reply("🔴 အများဆုံး 25,000 MMK ထိသာ လောင်းနိုင်ပါသည်။");
    }

    const user = await User.findOneAndUpdate(
      { id: userId, balance: { $gte: betAmount } },
      { $inc: { balance: -betAmount } },
      { new: true }
    );

    if (!user) {
      return ctx.reply(getString("NO_BALANCE"));
    }

    activeSpins.add(userId);

    const waitMsg = await ctx.reply("⚡️", { reply_to_message_id: ctx.message.message_id });

    const getDesign = (s1, s2, s3, s4, bet = "", win = "", profit = "", status = "") =>
      `🎰 GUESS SLOT V2.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━━━┓\n┃ ${s1} | ${s2} | ${s3} | ${s4} ┃\n┗━━━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${bet} MMK\n💰 Win     : ${win} MMK\n📊 Profit  : ${profit} MMK [${status}]\n✦ ━━━━━━━━━━━ ✦`;

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
        { $inc: { balance: winAmount } }
      );
    } else {
      await increaseBankAmount({ ctx, increaseAmount: betAmount }).catch(err =>
        logger.error("Bank update error: " + err.message)
      );
    }

    const profitText = profit >= 0 ? `+${profit}` : `${profit}`;

    setTimeout(async () => {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          waitMsg.message_id,
          null,
          getDesign(result1, result2, result3, result4, betAmount, winAmount, profitText, status)
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
const wljHandler = async (ctx) => {
  const ownerId = process.env.OWNER_ID;
  if (ctx.from.id.toString() !== ownerId) return;

  const lines = [
    `🎰 Slot WLJ System`,
    ``,
    `📊 Base Rates`,
    `   Win  : ${BASE_WIN}%`,
    `   Lose : ${BASE_LOSE}%`,
    `   💎   : ${BASE_JACKPOT}% (${MULTI_JACKPOT}x)`,
    ``,
    `🔄 Streak Adjustments`,
    `   3+ consec. Lose → +${BOOST_WIN_ON_LOSS_STREAK}% Win (max ${MAX_WIN_RATE}%)`,
    `   2+ consec. Win  → -${REDUCE_WIN_ON_WIN_STREAK}% Win (min ${MIN_WIN_RATE}%)`,
    ``,
    `🏆 Payouts`,
    `   2-of-a-kind : ${MULTI_2KIND}x`,
    `   3-of-a-kind : ${MULTI_3KIND}x`,
    `   4-of-a-kind : ${MULTI_4KIND}x`,
    `   4 💎        : ${MULTI_JACKPOT}x (Jackpot)`,
    ``,
    `👥 Active history: ${userHistory.size} user(s) tracked`,
  ];

  return ctx.reply(lines.join("\n"));
};

const composer = new Composer();
composer.command(getCommandName("slot"), slotHandler);
composer.command("wlj", wljHandler);
composer.hears(/^\.slot(\s+.*)?$/, slotHandler);

module.exports = composer;
