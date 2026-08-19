const { Composer } = require("telegraf");

const { isOwner } = require("../modules/owner.module");

const composer = new Composer();

composer.command("maintenance", async (ctx) => {
  if (!isOwner(ctx) || ctx.chat?.type !== "private") {
    return ctx.reply("🔒 Owner DM only.");
  }
  return ctx.scene.enter("gram-wallet");
});

module.exports = composer;
