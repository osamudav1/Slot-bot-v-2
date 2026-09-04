const { Composer } = require("telegraf");
const { getUser } = require("../modules/user.module");
const { getCommandName } = require("../lang/index");
const {
  getBalance,
  getDailySpinCount,
  DAILY_SPIN_LIMIT,
} = require("../modules/slot-wallet.module");

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

const walletHandler = async (ctx) => {
  await getUser({ id: ctx.from.id, firstName: ctx.from.first_name });
  const balance = await getBalance(ctx.from.id);
  const todaySpinCount = await getDailySpinCount(ctx.from.id);
  const badge = getBadge(balance);
  const firstName = ctx.from.first_name;
  const formatBalance = (amount) => (amount / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const response = `🏦『 ${firstName} ᴡᴀʟʟᴇᴛ 』\n` +
    `🎰 Balance ⇢ $${formatBalance(balance)}\n` +
    `🎲 Today spin ⇢ ${todaySpinCount}/${DAILY_SPIN_LIMIT}\n` +
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
