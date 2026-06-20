const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const slotHandler = async (ctx) => {
  try {
    const args = ctx.message.text.split(" ");
    const betAmount = args[1] ? parseInt(args[1]) : 2;

    if (isNaN(betAmount) || betAmount <= 0) {
      return ctx.reply("Usage: /slot <amount> or .slot <amount>");
    }

    // Atomic check and decrement of balance to handle concurrency
    const user = await User.findOneAndUpdate(
      { id: ctx.from.id, balance: { $gte: betAmount } },
      { $inc: { balance: -betAmount } },
      { new: true }
    );

    if (!user) {
      return ctx.reply(getString("NO_BALANCE"));
    }

    let slots = ["🍎", "🍌", "🍊", "🍐", "🍒", "🍉"];
    
    const getDesign = (s1, s2, s3, bet = "", win = "", profit = "") => {
        return `🎰 GUESS SLOT V1.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━┓\n┃   ${s1}     |      ${s2}   |    ${s3}   ┃\n┗━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${bet}\n💰 Win     : ${win}\n📊 Profit  : ${profit}\n✦ ━━━━━━━━━━━ ✦`;
    };

    const slotMsg = await ctx.reply(getDesign("❓", "❓", "❓", betAmount, "...", "..."));
    
    // Animation effect
    let animCount = 0;
    const animationInterval = setInterval(async () => {
        const r1 = slots[Math.floor(Math.random() * slots.length)];
        const r2 = slots[Math.floor(Math.random() * slots.length)];
        const r3 = slots[Math.floor(Math.random() * slots.length)];
        
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            slotMsg.message_id,
            null,
            getDesign(r1, r2, r3, betAmount, "Spinning...", "...")
        ).catch(() => {});
        
        animCount++;
        if (animCount >= 4) clearInterval(animationInterval);
    }, 700);

    let result1 = Math.floor(Math.random() * slots.length);
    let result2 = Math.floor(Math.random() * slots.length);
    let result3 = Math.floor(Math.random() * slots.length);

    const isThreeMatch = slots[result1] === slots[result2] && slots[result2] === slots[result3];
    const isTwoMatch = slots[result1] === slots[result2] || slots[result2] === slots[result3] || slots[result1] === slots[result3];
    
    let winMultiplier = 0;
    if (isThreeMatch) {
        winMultiplier = 5;
    } else if (isTwoMatch) {
        winMultiplier = 2;
    }

    const winAmount = betAmount * winMultiplier;
    const profit = winAmount - betAmount;

    setTimeout(async () => {
      clearInterval(animationInterval);
      
      if (winAmount > 0) {
        await User.findOneAndUpdate(
          { id: ctx.from.id },
          { $inc: { balance: winAmount } }
        );
      } else {
        await increaseBankAmount({ ctx, increaseAmount: betAmount });
      }

      return await ctx.telegram.editMessageText(
        ctx.chat.id,
        slotMsg.message_id,
        null,
        getDesign(slots[result1], slots[result2], slots[result3], betAmount, winAmount, profit > 0 ? `+${profit}` : profit)
      ).catch(err => logger.error(err));
    }, 3000);

  } catch (err) {
    logger.error(err);
    return ctx.reply(getString("DATABASE_LOCK"));
  }
};

const composer = new Composer();

// Handle /slot
composer.command(getCommandName("slot"), slotHandler);

// Handle .slot
composer.hears(/^\.slot(\s+.*)?$/, slotHandler);

module.exports = composer;
