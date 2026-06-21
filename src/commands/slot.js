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

    if (isNaN(betAmount) || betAmount <= 0) {
      return ctx.reply("Usage: /slot <amount> or .slot <amount>");
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

    const getDesign = (s1, s2, s3, bet = "", win = "", profit = "", status = "") => {
        return `🎰 GUESS SLOT V1.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━┓\n┃   ${s1}     |      ${s2}   |    ${s3}   ┃\n┗━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${bet} MMK\n💰 Win     : ${win} MMK\n📊 Profit  : ${profit} MMK [${status}]\n✦ ━━━━━━━━━━━ ✦`;
    };

    const slots = ["🍒", "🍎", "🍐", "🍉", "🍊", "🍌", "🍇", "🍓", "🫐", "🍈", "🍍", "🥭", "🍑", "🍒", "🥝"];
    const jackpotEmoji = "💎";

    const percentages = global.slotPercentages || { W: 55, L: 40, J: 5 };
    const random = Math.random() * 100;

    let result1, result2, result3;
    let winMultiplier = 0;
    let status = "Lose";

    if (random < percentages.J) {
        result1 = result2 = result3 = jackpotEmoji;
        winMultiplier = 100;
        status = "Jackpot";
    } else if (random < percentages.J + percentages.W) {
        const isTriple = Math.random() > 0.8;
        if (isTriple) {
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = result3 = sym;
            const multipliers = [10, 20, 32, 64, 80];
            winMultiplier = multipliers[Math.floor(Math.random() * multipliers.length)];
        } else {
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = sym;
            let other;
            do {
                other = slots[Math.floor(Math.random() * slots.length)];
            } while (other === sym);
            result3 = other;
            winMultiplier = Math.floor(Math.random() * 4) + 2;
        }
        status = "Win";
    } else {
        result1 = slots[Math.floor(Math.random() * slots.length)];
        do {
            result2 = slots[Math.floor(Math.random() * slots.length)];
        } while (result2 === result1);
        do {
            result3 = slots[Math.floor(Math.random() * slots.length)];
        } while (result3 === result1 || result3 === result2);
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
                getDesign(result1, result2, result3, betAmount, winAmount, profitText, status)
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
