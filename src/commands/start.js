const { Composer, Markup } = require("telegraf");
const { getString } = require("../lang/index");
const { ownerContact } = require("../modules/owner.module");

const composer = new Composer();

composer.command("start", async (ctx) => {
  const ownerLink = ownerContact();
  const welcomeMessage = `👋 Welcome to Guess Slot Bot v2!\n\n${getString("EARN_MONEY_TIP")}`;
  
  return ctx.reply(welcomeMessage, Markup.inlineKeyboard([
    [Markup.button.url("👤 Owner", ownerLink)]
  ]));
});

module.exports = composer;
