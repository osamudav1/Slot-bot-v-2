const { Composer } = require("telegraf");

const composer = new Composer();

composer.command("gramwallet", async (ctx) => {
  if (String(ctx.from?.id) !== String(process.env.OWNER_ID) || ctx.chat?.type !== "private") {
    return ctx.reply("🔒 Owner DM only.");
  }
  return ctx.scene.enter("gram-wallet");
});

module.exports = composer;
