const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const activeSpins = new Set();

const slotHandler = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const ownerId = process.env.OWNER_ID;
    const currentUserId = userId.toString();
    const text = ctx.message.text || "";

    // Handle percentage updates (Owner only)
    if (ownerId && currentUserId === ownerId && text.includes("W") && text.includes("L") && text.includes("J")) {
        const wMatch = text.match(/W\s*(\d+)%/);
        const lMatch = text.match(/L\s*(\d+)%/);
        const jMatch = text.match(/J\s*(\d+)%/);
        
        if (wMatch && lMatch && jMatch) {
            global.slotPercentages = {
                W: parseInt(wMatch[1]),
                L: parseInt(lMatch[1]),
                J: parseInt(jMatch[1])
            };
            return ctx.reply(`✅ Slot percentages updated:\nWin: ${global.slotPercentages.W}%\nLose: ${global.slotPercentages.L}%\nJackpot: ${global.slotPercentages.J}%`);
        }
    }

    if (activeSpins.has(userId)) {
        return ctx.reply("Please wait for your current spin to finish!").catch(() => {});
    }

    const args = text.split(" ");
    const betAmount = args[1] ? parseInt(args[1]) : 1000;

    if (isNaN(betAmount)) {
      return ctx.reply("Usage: /slot <amount> or .slot <amount>");
    }

    // Enforce betting limits
    if (betAmount < 500) {
      return ctx.reply("🔴 အနည်းဆုံး 500 MMK လောင်းရပါမည်။");
    }
    if (betAmount > 15000) {
      return ctx.reply("🔴 အများဆုံး 15,000 MMK ထိသာ လောင်းနိုင်ပါသည်။");
    }

    // Atomic update to check and deduct balance
    const user = await User.findOneAndUpdate(
      { id: userId, balance: { $gte: betAmount } },
      { $inc: { balance: -betAmount } },
      { new: true }
    );

    if (!user) {
      return ctx.reply(getString("NO_BALANCE"));
    }

    activeSpins.add(userId);

    // Show lightning emoji first
    const waitMsg = await ctx.reply("⚡️");

    const getDesign = (s1, s2, s3, s4, bet = "", win = "", profit = "", status = "") => {
        return `🎰 GUESS SLOT V1.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━━━┓\n┃ ${s1} | ${s2} | ${s3} | ${s4} ┃\n┗━━━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${bet} MMK\n💰 Win     : ${win} MMK\n📊 Profit  : ${profit} MMK [${status}]\n✦ ━━━━━━━━━━━ ✦`;
    };

    const fruitRewards = {
        "🍒": 3, "🍎": 4, "🍐": 4, "🍉": 5, "🍊": 5, 
        "🍌": 6, "🍇": 6, "🍓": 7, "🫐": 7, "🍈": 8, 
        "🍍": 8, "🥭": 9, "🍑": 9, "🥝": 10
    };
    const slots = Object.keys(fruitRewards);
    const jackpotEmoji = "💎";

    const percentages = global.slotPercentages || { W: 45, L: 52, J: 3 }; 
    const random = Math.random() * 100;

    let result1, result2, result3, result4;
    let winMultiplier = 0;
    let status = "Lose";

    if (random < percentages.J) {
        // Jackpot Case: 4 diamonds
        result1 = result2 = result3 = result4 = jackpotEmoji;
        winMultiplier = 25;
        status = "Jackpot (25x)";
    } else if (random < percentages.J + percentages.W) {
        const winType = Math.random() * 100;
        
        if (winType < 10) { 
            // 4-of-a-kind (Quadruple)
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = result3 = result4 = sym;
            winMultiplier = 15;
            status = `Win (${winMultiplier}x)`;
        } else if (winType < 40) {
            // 3-of-a-kind (Triple)
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = result3 = sym;
            let other;
            do {
                other = slots[Math.floor(Math.random() * slots.length)];
            } while (other === sym);
            result4 = other;
            winMultiplier = fruitRewards[sym] || 5;
            status = `Win (${winMultiplier}x)`;
        } else {
            // 2-of-a-kind (Double)
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = sym;
            let other1, other2;
            do {
                other1 = slots[Math.floor(Math.random() * slots.length)];
            } while (other1 === sym);
            do {
                other2 = slots[Math.floor(Math.random() * slots.length)];
            } while (other2 === sym || other2 === other1);
            result3 = other1;
            result4 = other2;
            winMultiplier = 2;
            status = `Win (${winMultiplier}x)`;
        }
    } else {
        // Lose Case
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

    // Credit win amount or add to bank
    if (winAmount > 0) {
      await User.findOneAndUpdate(
        { id: userId },
        { $inc: { balance: winAmount } }
      );
    } else {
      await increaseBankAmount({ ctx, increaseAmount: betAmount }).catch(err => logger.error("Bank update error: " + err.message));
    }

    const profitText = profit >= 0 ? `+${profit}` : `${profit}`;

    // Wait for 1.5 seconds, then edit the lightning emoji message with results
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

const composer = new Composer();
composer.command(getCommandName("slot"), slotHandler);
composer.hears(/^\.slot(\s+.*)?$/, slotHandler);
composer.hears(/W\s*\d+%\s*L\s*\d+%\s*J\s*\d+%/, slotHandler);

module.exports = composer;
