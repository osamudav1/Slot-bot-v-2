const { Composer } = require("telegraf");
const { getUser } = require("../modules/user.module");
const { getString, getCommandName } = require("../lang/index");

module.exports = Composer.command(getCommandName("bank"), async (ctx) => {
  const user = await getUser({ id: ctx?.update?.message?.from?.id });
  ctx.reply(`🏦 Bank | ${ctx?.update?.message?.from?.first_name}\n💰 ${getString("MONEY")} : ${user?.balance ? user?.balance : "0"}\n💎 ${getString("DIAMOND")}: 0 `);
});
