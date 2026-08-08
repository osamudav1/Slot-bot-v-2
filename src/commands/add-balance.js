const { Composer } = require("telegraf");
const { getUser, setUser } = require("../modules/user.module");
const { getCommandName } = require("../lang/index");

module.exports = Composer.command(getCommandName("add"), async (ctx) => {
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
    amount = parseInt(args[1]);
  } 
  // Case 2: Use user ID (/add userid amount)
  else if (args.length >= 3) {
    targetUserId = args[1];
    amount = parseInt(args[2]);
  }

  if (!targetUserId || isNaN(amount)) {
    return ctx.reply("Usage:\n1. Reply to user: /add <amount>\n2. Use ID: /add <userid> <amount>\nExample: /add 12345678 1000 or /add 12345678 -1000");
  }

  try {
    const targetUserEntity = await getUser({ id: targetUserId });
    if (!targetUserEntity) {
        return ctx.reply("🔴 User not found in database.");
    }

    targetUserEntity.balance = (targetUserEntity.balance || 0) + amount;
    await setUser({ user: targetUserEntity });

    return ctx.reply(`✅ Successfully updated balance for user ID: ${targetUserId}.\nNew Balance: ${targetUserEntity.balance} $`);
  } catch (err) {
    console.error(err);
    return ctx.reply("🔴 An error occurred while updating balance.");
  }
});
