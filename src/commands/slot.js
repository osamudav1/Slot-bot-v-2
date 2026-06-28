const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const activeSpins = new Set();

// Default RTP 90%
const DEFAULT_RTP = 90;
const JACKPOT_PERCENT = 3;
const JACKPOT_MULTI = 10;

// Calculate Win% from target RTP
// RTP = J×10 + W×(0.10×6 + 0.30×3 + 0.60×2) = J×10 + W×2.7
// W = (RTP - J×10) / 2.7
const getRTPPercentages = () => {
  const rtp = (global.slotRTP || DEFAULT_RTP) / 100;
  const jackpotContrib = (JACKPOT_PERCENT / 100) * JACKPOT_MULTI;
  let winRate = (rtp - jackpotContrib) / 2.7;
  winRate = Math.max(0, Math.min(winRate, 0.97 - JACKPOT_PERCENT / 100));
  const loseRate = (1 - JACKPOT_PERCENT / 100) - winRate;
  return {
    J: JACKPOT_PERCENT,
    W: Math.round(winRate * 100 * 10) / 10,
    L: Math.round(loseRate * 100 * 10) / 10,
  };
};

const slotHandler = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const ownerId = process.env.OWNER_ID;
    const currentUserId = userId.toString();
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

    const getDesign = (s1, s2, s3, s4, bet = "", win = "", profit = "", status = "") => {
        return `🎰 GUESS SLOT V1.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━━━┓\n┃ ${s1} | ${s2} | ${s3} | ${s4} ┃\n┗━━━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${bet} MMK\n💰 Win     : ${win} MMK\n📊 Profit  : ${profit} MMK [${status}]\n✦ ━━━━━━━━━━━ ✦`;
    };

    const slots = ["🍒", "🍎", "🍐", "🍉", "🍊", "🍌", "🍇", "🍓", "🫐", "🍈", "🍍", "🥭", "🍑", "🥝"];
    const jackpotEmoji = "💎";

    const pct = getRTPPercentages();
    const random = Math.random() * 100;

    let result1, result2, result3, result4;
    let winMultiplier = 0;
    let status = "Lose";

    if (random < pct.J) {
        // Jackpot: 4 diamonds → 10x
        result1 = result2 = result3 = result4 = jackpotEmoji;
        winMultiplier = JACKPOT_MULTI;
        status = `Jackpot (${JACKPOT_MULTI}x)`;
    } else if (random < pct.J + pct.W) {
        const winType = Math.random() * 100;

        if (winType < 10) {
            // 4-of-a-kind → 6x
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = result3 = result4 = sym;
            winMultiplier = 6;
            status = `Win (${winMultiplier}x)`;
        } else if (winType < 40) {
            // 3-of-a-kind → 3x
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = result3 = sym;
            let other;
            do { other = slots[Math.floor(Math.random() * slots.length)]; } while (other === sym);
            result4 = other;
            winMultiplier = 3;
            status = `Win (${winMultiplier}x)`;
        } else {
            // 2-of-a-kind → 2x
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = sym;
            let other1, other2;
            do { other1 = slots[Math.floor(Math.random() * slots.length)]; } while (other1 === sym);
            do { other2 = slots[Math.floor(Math.random() * slots.length)]; } while (other2 === sym || other2 === other1);
            result3 = other1;
            result4 = other2;
            winMultiplier = 2;
            status = `Win (${winMultiplier}x)`;
        }
    } else {
        // Lose
        const shuffled = [...slots].sort(() => 0.5 - Math.random());
        result1 = shuffled[0];
        result2 = shuffled[1];
        result3 = shuffled[2];
        result4 = shuffled[3];
        winMultiplier = 0;
        status = "Lose";
    }

    const winAmount = betAmount * winMultiplier;
    const profit = winAmount - betAmount;

    if (winAmount > 0) {
      await User.findOneAndUpdate(
        { id: userId },
        { $inc: { balance: winAmount } }
      );
    } else {
      await increaseBankAmount({ ctx, increaseAmount: betAmount }).catch(err => logger.error("Bank update error: " + err.message));
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

// /rtp command — owner only
const rtpHandler = async (ctx) => {
  const ownerId = process.env.OWNER_ID;
  if (ctx.from.id.toString() !== ownerId) return;

  const args = ctx.message.text.split(" ");
  const input = args[1] ? parseFloat(args[1]) : null;

  if (!input || isNaN(input) || input < 50 || input > 99) {
    const current = global.slotRTP || DEFAULT_RTP;
    const pct = getRTPPercentages();
    return ctx.reply(
      `🎰 Slot RTP Settings\n\n` +
      `လက်ရှိ RTP: ${current}%\n` +
      `Win Rate: ${pct.W}%\n` +
      `Lose Rate: ${pct.L}%\n` +
      `Jackpot: ${pct.J}% (10x)\n\n` +
      `ပြောင်းလဲရန်: /rtp <50-99>\n` +
      `Example: /rtp 90`
    );
  }

  global.slotRTP = input;
  const pct = getRTPPercentages();

  return ctx.reply(
    `✅ Slot RTP ပြောင်းလဲပြီး\n\n` +
    `🎯 RTP: ${input}%\n` +
    `📈 Win Rate: ${pct.W}%\n` +
    `📉 Lose Rate: ${pct.L}%\n` +
    `💎 Jackpot: ${pct.J}% (10x)\n\n` +
    `⚠️ Bot restart ရင် default ${DEFAULT_RTP}% ပြန်သွားမည်`
  );
};

const composer = new Composer();
composer.command(getCommandName("slot"), slotHandler);
composer.command("rtp", rtpHandler);
composer.hears(/^\.slot(\s+.*)?$/, slotHandler);

module.exports = composer;
