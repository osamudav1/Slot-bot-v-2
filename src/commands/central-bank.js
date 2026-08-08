const { Composer } = require("telegraf");
const { getBankInfo } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");

module.exports = Composer.command(getCommandName("centralbank"), async (ctx) => {
  const bankInfo = await getBankInfo({ ctx });
  const formattedBalance = `$${(bankInfo.coins / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  ctx.reply(`${getString("TOTAL_AMOUNT")} ${formattedBalance} 💰 ${getString("BANK_INFO")} `);
});
