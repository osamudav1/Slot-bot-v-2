const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const { getUser } = require("../modules/user.module");
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

    let slots = ["🍎", "🍌", "🍊", "🍐", "🍒"];
    let result1 = Math.floor(Math.random() * slots.length);
    let result2 = Math.floor(Math.random() * slots.length);
    let result3 = Math.floor(Math.random() * slots.length);

    const slotMsg = await ctx.reply(`${getString("SLOT_SPINNING")}`);
    
    // Animation effect
    const animationInterval = setInterval(async () => {
        const r1 = Math.floor(Math.random() * slots.length);
        const r2 = Math.floor(Math.random() * slots.length);
        const r3 = Math.floor(Math.random() * slots.length);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            slotMsg.message_id,
            null,
            `🎰 | ${slots[r1]} | ${slots[r2]} | ${slots[r3]} | 🎰`
        ).catch(() => {});
    }, 800);

    const isThreeMatch = slots[result1] === slots[result2] && slots[result2] === slots[result3];
    const isTwoMatch = slots[result1] === slots[result2] || slots[result2] === slots[result3] || slots[result1] === slots[result3];
    
    let winMultiplier = 0;
    if (isThreeMatch) {
        winMultiplier = 5;
    } else if (isTwoMatch) {
        winMultiplier = 2;
    }

    const winAmount = betAmount * winMultiplier;

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

      const resultText = winAmount > 0 
        ? `🤑 ${getString("SLOT_WIN")} ${winAmount}` 
        : `🥶 ${getString("SLOT_LOSS")} ${betAmount}`;

      return await ctx.telegram.editMessageText(
        ctx.chat.id,
        slotMsg.message_id,
        null,
        `${getString("SLOT_MACHINE")}:\n${slots[result1]} | ${slots[result2]} | ${slots[result3]}\n ${resultText}`
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
