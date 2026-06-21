const { Composer } = require("telegraf");
const { registerGroup } = require("../modules/group.module");

module.exports = Composer.command("register", async (ctx) => {
  const ownerId = process.env.OWNER_ID;
  const currentUserId = ctx.from.id.toString();

  if (ownerId && currentUserId !== ownerId) {
    return; // Ignore if not owner
  }

  if (ctx.chat.type === "private") {
    return ctx.reply("This command can only be used in groups.");
  }

  try {
    await registerGroup(ctx.chat.id.toString(), ctx.chat.title, currentUserId);
    return ctx.reply("✅ ဘော့ကအာ့Gpမှာအလုပ်သလြပ်ဆော့လို့းပီ");
  } catch (err) {
    console.error(err);
    return ctx.reply("🔴 Error registering group.");
  }
});
