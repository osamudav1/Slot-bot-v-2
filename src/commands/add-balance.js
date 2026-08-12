const { Composer } = require("telegraf");
const { getUser, setUser } = require("../modules/user.module");
const { getCommandName } = require("../lang/index");

const composer = new Composer();

composer.command(getCommandName("add"), async (ctx) => {
  const ownerId = process.env.OWNER_ID;
  const currentUserId = ctx.from.id.toString();

  if (ownerId && currentUserId !== ownerId) {
    return; // Ignore if not owner
  }

  const args = ctx.message.text.split(" ");
  let targetUserId;
  let amount;

  // Case 1: Reply to a message (/add amount)
  if (ctx.message.reply_to_message) {
    targetUserId = ctx.message.reply_to_message.from.id;
    amount = Math.floor(parseFloat(args[1]) * 100);
  } 
  // Case 2: Use user ID (/add userid amount)
  else if (args.length >= 3) {
    targetUserId = args[1];
    amount = Math.floor(parseFloat(args[2]) * 100);
  }

  if (!targetUserId || isNaN(amount)) {
    return ctx.reply("Usage:\n1. Reply to user: /add <amount_in_dollars>\n2. Use ID: /add <userid> <amount_in_dollars>\nExample: /add 12345678 10.5 or /add 12345678 -5");
  }

  try {
    const targetUserEntity = await getUser({ id: targetUserId });
    if (!targetUserEntity) {
        return ctx.reply("🔴 User not found in database.");
    }

    targetUserEntity.coins = (targetUserEntity.coins || 0) + amount;
    await setUser({ user: targetUserEntity });

    const formattedBalance = `$${(targetUserEntity.coins / 100).toFixed(2)}`;
    return ctx.reply(`✅ Successfully updated balance for user ID: ${targetUserId}.\nNew Balance: ${formattedBalance}`);
  } catch (err) {
    console.error(err);
    return ctx.reply("🔴 An error occurred while updating balance.");
  }
});

module.exports = composer;
