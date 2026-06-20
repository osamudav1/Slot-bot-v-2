const { Composer } = require("telegraf");
const { getString } = require("../lang/index");

module.exports = Composer.command("start", async (ctx) => {
  const welcomeMessage = `👋 Welcome to Slot Bot v2!\n\n${getString("HOW_TO_BUY")}\n\n${getString("EARN_MONEY_TIP")}`;
  return ctx.reply(welcomeMessage);
});
