const { Composer } = require("telegraf");
const { increaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

// Simple in-memory lock to prevent concurrent spins for the same user
const activeSpins = new Set();

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

    // Prevent multiple concurrent spins for the same user
    if (activeSpins.has(ctx.from.id)) {
        return ctx.reply("Please wait for your current spin to finish!").catch(() => {});
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

    // Mark user as actively spinning
    activeSpins.add(ctx.from.id);

    // Send waiting status
    const waitMsg = await ctx.reply("🎰 Spinning...");

    const getDesign = (s1, s2, s3, bet = "", win = "", profit = "", status = "") => {
        return `🎰 GUESS SLOT V1.0\n✦ ━━━━━━━━━━━ ✦\n\n┏━━━━━━━━━━━┓\n┃   ${s1}     |      ${s2}   |    ${s3}   ┃\n┗━━━━━━━━━━━┛\n\n✦ ━━━━━━━━━━━ ✦\n🎰 SLOT DETAILS\n✦ ━━━━━━━━━━━ ✦\n💵 Bet     : ${bet}\n💰 Win     : ${win}\n📊 Profit  : ${profit} [${status}]\n✦ ━━━━━━━━━━━ ✦`;
    };

    const slots = ["🍒", "🍎", "🍐", "🍉", "🍊", "🍌", "🍇", "🍓", "🫐", "🍈", "🍍", "🥭", "🍑", "🍒", "🥝"];
    const jackpotEmoji = "💎";

    // Use default or custom percentages
    const percentages = global.slotPercentages || { W: 55, L: 40, J: 5 };
    const random = Math.random() * 100;

    let result1, result2, result3;
    let winMultiplier = 0;
    let status = "Lose";

    if (random < percentages.J) {
        // Jackpot: J 5% -> 100x
        result1 = result2 = result3 = jackpotEmoji;
        winMultiplier = 100;
        status = "Jackpot";
    } else if (random < percentages.J + percentages.W) {
        // Win: W 55%
        const isTriple = Math.random() > 0.8;
        if (isTriple) {
            const sym = slots[Math.floor(Math.random() * slots.length)];
            result1 = result2 = result3 = sym;
            // Triple fruits: 10x to 64x
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
            // Double fruits: 2x to 5x
            winMultiplier = Math.floor(Math.random() * 4) + 2;
        }
        status = "Win";
    } else {
        // Lose: L 40%
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

    // Animation: 3 steps of spinning
    let animCount = 0;
    const animationInterval = setInterval(async () => {
        const r1 = slots[Math.floor(Math.random() * slots.length)];
        const r2 = slots[Math.floor(Math.random() * slots.length)];
        const r3 = slots[Math.floor(Math.random() * slots.length)];
        
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            null,
            getDesign(r1, r2, r3, betAmount, "Spinning...", "...", "Spinning")
        ).catch(() => {});
        
        animCount++;
        if (animCount >= 3) clearInterval(animationInterval);
    }, 600);

    // Final result after 2.2 seconds
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

      const profitText = profit >= 0 ? `+${profit}` : `${profit}`;

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        null,
        getDesign(result1, result2, result3, betAmount, winAmount, profitText, status)
      ).catch(err => logger.error(err));

      // Remove user from active spins
      activeSpins.delete(ctx.from.id);
    }, 2200);

  } catch (err) {
    logger.error(err);
    activeSpins.delete(ctx.from.id);
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
