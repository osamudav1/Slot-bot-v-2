const { Composer } = require("telegraf");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const { isOwner } = require("../modules/owner.module");

const composer = new Composer();

composer.command("broadcast", async (ctx) => {
  if (!isOwner(ctx)) return;

  const message = ctx.message.text.split(" ").slice(1).join(" ");
  if (!message && !ctx.message.reply_to_message) {
    return ctx.reply("Usage: /broadcast <message> or reply to a message with /broadcast");
  }

  const users = await User.find({}, "id");
  const totalUsers = users.length;
  let successCount = 0;
  let failCount = 0;

  const statusMsg = await ctx.reply(`Starting broadcast to ${totalUsers} users...`);

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      if (ctx.message.reply_to_message) {
        await ctx.telegram.copyMessage(user.id, ctx.chat.id, ctx.message.reply_to_message.message_id);
      } else {
        await ctx.telegram.sendMessage(user.id, message);
      }
      successCount++;
    } catch (err) {
      failCount++;
      logger.error(`Broadcast failed for ${user.id}: ${err.message}`);
    }

    // Update status every 50 users or at the end
    if ((i + 1) % 50 === 0 || i === users.length - 1) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        null,
        `Broadcast Progress: ${i + 1}/${totalUsers}\nSuccess: ${successCount}\nFailed: ${failCount}`
      ).catch(() => {});
    }

    // Rate limiting: 30 messages per second is the limit. 
    // We'll wait 35ms between each message to be safe (~28 msgs/sec).
    await new Promise(resolve => setTimeout(resolve, 35));
  }

  await ctx.reply(`✅ Broadcast completed!\nTotal: ${totalUsers}\nSuccess: ${successCount}\nFailed: ${failCount}`);
});

module.exports = composer;
