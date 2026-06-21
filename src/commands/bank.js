const { Composer } = require("telegraf");
const { getUser } = require("../modules/user.module");
const { getCommandName } = require("../lang/index");

const getBadge = (balance) => {
  if (balance <= 25000) return "🐣 Beginner";
  if (balance <= 70000) return "🐥 Rookie";
  if (balance <= 150000) return "🎮 Player";
  if (balance <= 300000) return "🧠 Skilled";
  if (balance <= 800000) return "🔥 Pro";
  if (balance <= 1300000) return "💎 Elite";
  if (balance <= 50000000) return "🛡️ Veteran";
  if (balance <= 100000000) return "👑 Master";
  if (balance <= 500000000) return "⚡️ Legend";
  return "💀 GOD LEVEL & Mythic";
};

module.exports = Composer.command(getCommandName("bank"), async (ctx) => {
  const user = await getUser({ id: ctx.from.id });
  const balance = user?.balance || 0;
  const badge = getBadge(balance);
  const firstName = ctx.from.first_name;

  // Format balance with commas
  const formattedBalance = balance.toLocaleString();

  const response = `🏦『 ${firstName} ʙᴀɴᴋ 』\n💰 MMK ⇢ ${formattedBalance}MMK\n💎 Rank ⇢ ${badge}`;
  
  await ctx.reply(response);
});
