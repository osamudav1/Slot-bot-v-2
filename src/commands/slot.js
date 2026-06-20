const { Composer } = require("telegraf");
const { increaseBankAmount, decreaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const slotHandler = async (ctx) => {
  try {
    const ownerId = process.env.OWNER_ID;
    const currentUserId = ctx.from.id.toString();

    const text = ctx.message.text || "";
    // Owner can send W 60% L 30% J 10% to set percentages
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

    const args = text.split(" ");
    const betAmount = args[1] ? parseInt(args[1]) : 1000;

    if (isNaN(betAmount) || betAmount <= 0) {
      return ctx.reply("Usage: /slot <amount> or .slot <amount>");
    }

    // Atomic check and decrement of balance
    const user = await User.findOneAndUpdate(
      { id: ctx.from.id, balance: { $gte: betAmount } },
      { $inc: { balance: -betAmount } },
      { new: true }
    );

    if (!user) {
      return ctx.reply(getString("NO_BALANCE"));
    }

    // Send waiting emoji
    const waitMsg = await ctx.reply("⏳");

    const getDesign = (s1, s2, s3, bet = "", win = "", profit = "", status = "") => {
        return `🎰 GUESS SLOT V1.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━┓\n┃   ${s1}     |      ${s2}   |    ${s3}   ┃\n┗━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${bet}\n💰 Win     : ${win}\n📊 Profit  : ${profit} [${status}]\n✦ ━━━━━━━━━━━ ✦`;
    };

    const slots = ["🍒", "🍎", "🍐", "🍉", "🍊", "🍌"];
    const jackpotEmoji = "💰";

    // Use default or custom percentages
    const percentages = global.slotPercentages || { W: 60, L: 30, J: 10 };
    const random = Math.random() * 100;

    let result1, result2, result3;
    let winMultiplier = 0;
    let status = "Lose";

    if (random < percentages.J) {
        // Jackpot: J 10% -> 25x
        result1 = result2 = result3 = jackpotEmoji;
        winMultiplier = 25;
        status = "Jackpot";
    } else if (random < percentages.J + percentages.W) {
        // Win: W 60% -> 2x (matching 2) or 5x (matching 3)
        // For simplicity, let's make it a guaranteed win of some sort
        const isTriple = Math.random() > 0.7;
        if (isTriple) {
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = result3 = sym;
            winMultiplier = 5;
        } else {
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = sym;
            let other;
            do {
                other = slots[Math.floor(Math.random() * slots.length)];
            } while (other === sym);
            result3 = other;
            winMultiplier = 2;
        }
        status = "Win";
    } else {
        // Lose: L 30%
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

    // Simulate delay
    setTimeout(async () => {
      // Delete waiting message
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

      if (winAmount > 0) {
        await User.findOneAndUpdate(
          { id: ctx.from.id },
          { $inc: { balance: winAmount } }
        );
        // If it's a win, we might need to take it from the bank if the bank is used as a pool
        // But the original code only added losses to the bank.
        // Let's stick to the bank logic: losses go to bank.
      } else {
        await increaseBankAmount({ ctx, increaseAmount: betAmount });
      }

      const profitText = profit >= 0 ? `+${profit}` : `${profit}`;

      return await ctx.reply(
        getDesign(result1, result2, result3, betAmount, winAmount, profitText, status)
      ).catch(err => logger.error(err));
    }, 2000);

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

// Handle owner setting percentages (W 60% L 30% J 10%)
composer.hears(/W\s*\d+%\s*L\s*\d+%\s*J\s*\d+%/, slotHandler);

module.exports = composer;
