const { Composer } = require("telegraf");
const { registerGroup } = require("../modules/group.module");

const composer = new Composer();

composer.command("register", async (ctx) => {
  const ownerId = process.env.OWNER_ID;
  const currentUserId = ctx.from.id.toString();

  if (ownerId && currentUserId !== ownerId) {
    return; // Ignore if not owner
  }

  const args = ctx.message.text.split(" ");
  const subCommand = args[1]?.toLowerCase();

  // Handle /register on/off in DM
  if (ctx.chat.type === "private") {
    if (subCommand === "on") {
      global.autoRegister = false; // "on" means manual registration is ON
      return ctx.reply("✅ Manual registration is now ON. Groups must be registered by owner.");
    } else if (subCommand === "off") {
      global.autoRegister = true; // "off" means manual registration is OFF (Auto-register)
      return ctx.reply("✅ Manual registration is now OFF. New groups will be automatically registered.");
    } else {
      return ctx.reply("Usage: /register on (Manual) or /register off (Auto)");
    }
  }

  // Group registration logic
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    try {
      const groupLink = ctx.chat.username ? `https://t.me/${ctx.chat.username}` : null;
      await registerGroup(ctx.chat.id.toString(), ctx.chat.title, currentUserId, groupLink);
      return ctx.reply("♻️ Approved ♻️");
    } catch (err) {
      console.error(err);
      return ctx.reply("🔴 Error registering group.");
    }
  }
});

module.exports = composer;
