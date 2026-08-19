const { Composer } = require("telegraf");
const { getPoolBalance, addToPool } = require("../modules/pool.module");
const logger = require("../logger");

const { isOwner } = require("../modules/owner.module");

const composer = new Composer();

composer.command("addpool", async (ctx) => {
  if (!isOwner(ctx)) return;

  const text = ctx.message.text || "";
  const args = text.split(" ");
  const amount = parseFloat(args[1]);

  if (isNaN(amount) || amount <= 0) {
    const currentPool = await getPoolBalance();
    return ctx.reply(`📊 Current Payout Pool: $${(currentPool / 100).toFixed(2)}\n\nUsage: /addpool <amount_in_dollars>\nExample: /addpool 100`);
  }

  try {
    const cents = Math.floor(amount * 100);
    await addToPool(cents);
    const newPool = await getPoolBalance();
    
    logger.info(`Owner added $${amount} to the payout pool.`);
    return ctx.reply(`✅ Successfully added $${amount.toFixed(2)} to the payout pool.\n💰 New Pool Balance: $${(newPool / 100).toFixed(2)}`);
  } catch (err) {
    logger.error("Add pool error: " + err.message);
    return ctx.reply("🔴 Error adding to pool. Please try again.");
  }
});

module.exports = composer;
