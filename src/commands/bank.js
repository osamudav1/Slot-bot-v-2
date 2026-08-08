const { Composer } = require("telegraf");
const { getUser } = require("../modules/user.module");
const { getCommandName } = require("../lang/index");

const getBadge = (coins) => {
  if (coins <= 25000) return "🐣 Beginner";
  if (coins <= 70000) return "🐥 Rookie";
  if (coins <= 150000) return "🎮 Player";
  if (coins <= 300000) return "🧠 Skilled";
  if (coins <= 800000) return "🔥 Pro";
  if (coins <= 1300000) return "💎 Elite";
  if (coins <= 50000000) return "🛡️ Veteran";
  if (coins <= 100000000) return "👑 Master";
  if (coins <= 500000000) return "⚡️ Legend";
  return "💀 GOD LEVEL & Mythic";
};

module.exports = Composer.command(getCommandName("bank"), async (ctx) => {
  const user = await getUser({ id: ctx.from.id, firstName: ctx.from.first_name });
  const coins = user?.coins || 0;
  const badge = getBadge(coins);
  const firstName = ctx.from.first_name;

  // Format balance with commas
  const formattedBalance = (coins / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const response = `🏦『 ${firstName} ʙᴀɴᴋ 』\n💰 $ ⇢ ${formattedBalance}$\n💎 Rank ⇢ ${badge}`;
  
  try {
    const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1);
    if (photos.total_count > 0) {
      const photoId = photos.photos[0][0].file_id;
      return await ctx.replyWithPhoto(photoId, { caption: response });
    }
  } catch (err) {
    console.error("Error getting user profile photo:", err);
  }

  await ctx.reply(response);
});
