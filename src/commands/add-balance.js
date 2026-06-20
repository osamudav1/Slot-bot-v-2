const { Composer } = require("telegraf");
const { getUser, setUser } = require("../modules/user.module");
const { getString, getCommandName } = require("../lang/index");

module.exports = Composer.command(getCommandName("add"), async (ctx) => {
  const ownerId = process.env.OWNER_ID;
  const currentUserId = ctx.from.id.toString();

  if (ownerId && currentUserId !== ownerId) {
    return; // Ignore if not owner
  }

  const targetUser = ctx.update.message?.reply_to_message?.from;
  if (!targetUser) return ctx.reply("Please reply to a user message to add/remove balance.");

  const amount = parseInt(ctx?.update?.message?.text.split(" ")[1]);
  if (isNaN(amount)) return ctx.reply("Usage: /add <amount> (e.g., /add 100 or /add -100)");

  const targetUserEntity = await getUser({ id: targetUser.id });
  targetUserEntity.balance = (targetUserEntity.balance || 0) + amount;

  await setUser({ user: targetUserEntity });

  return ctx.reply(`✅ Successfully updated balance for ${targetUser.first_name}.\nNew Balance: ${targetUserEntity.balance}`);
});
