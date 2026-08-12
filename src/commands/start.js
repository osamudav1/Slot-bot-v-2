const { Composer, Markup } = require("telegraf");
const { getString } = require("../lang/index");

const composer = new Composer();

composer.command("start", async (ctx) => {
  const ownerId = process.env.OWNER_ID || "pyaesone2d2"; // Fallback if env not set
  const welcomeMessage = `👋 Welcome to Guess Slot Bot v2!\n\n${getString("EARN_MONEY_TIP")}`;
  
  return ctx.reply(welcomeMessage, Markup.inlineKeyboard([
    [Markup.button.url("👤 Owner", `tg://user?id=${ownerId}`)]
  ]));
});

module.exports = composer;
