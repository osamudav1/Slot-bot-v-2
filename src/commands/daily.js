const { Composer } = require("telegraf");
const User = require("../database/entity/user.entitiy");
const { getUser, setUser } = require("../modules/user.module");
const { getString } = require("../lang/index");

module.exports = Composer.command("daily", async (ctx) => {
  try {
    const user = await getUser({ id: ctx.from.id });
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;

    if (user.last_daily_time && now - user.last_daily_time < oneDay) {
      const remaining = oneDay - (now - user.last_daily_time);
      const hours = Math.floor(remaining / (60 * 60 * 1000));
      const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
      return ctx.reply(`🕒 You already claimed your daily reward. Come back in ${hours}h ${minutes}m.`);
    }

    const reward = Math.floor(Math.random() * (6000 - 1000 + 1)) + 1000;
    user.balance += reward;
    user.last_daily_time = now;
    await setUser({ user });

    return ctx.reply(`🎁 Daily Reward: You received ${reward} MMK!`);
  } catch (err) {
    console.error(err);
    return ctx.reply("🔴 An error occurred while claiming your daily reward.");
  }
});
