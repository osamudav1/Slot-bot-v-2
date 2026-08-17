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

const walletHandler = async (ctx) => {
  const user = await getUser({ id: ctx.from.id, firstName: ctx.from.first_name });
  const coins = user?.coins || 0;
  const slotWallet = user?.slot_wallet || 0;
  const badge = getBadge(coins);
  const firstName = ctx.from.first_name;
  const formatBalance = (amount) => (amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const response = `🏦『 ${firstName} ᴡᴀʟʟᴇᴛ 』\n` +
    `💰 Waifu ⇢ $${formatBalance(coins)}\n` +
    `🎰 Slot  ⇢ $${formatBalance(slotWallet)}\n` +
    `💎 Rank ⇢ ${badge}`;

  try {
    const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1);
    if (photos.total_count > 0) {
      const photoId = photos.photos[0][0].file_id;
      return await ctx.replyWithPhoto(photoId, { caption: response });
    }
  } catch (err) {
    console.error("Error getting user profile photo:", err);
  }

  return ctx.reply(response);
};

const composer = new Composer();
composer.command(getCommandName("bank") || "wallet", walletHandler);
composer.command("bal", walletHandler);

module.exports = composer;
