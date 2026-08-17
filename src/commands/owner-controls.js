const { Composer } = require("telegraf");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");
const { getPoolBalance } = require("../modules/pool.module");
const {
  DEFAULTS,
  getOwnerSettings,
  setOwnerSetting,
  resetOwnerSettings,
} = require("../modules/owner-settings.module");

const composer = new Composer();

const isOwner = (ctx) => String(ctx.from?.id) === String(process.env.OWNER_ID);
const ownerOnly = async (ctx) => {
  if (!isOwner(ctx)) {
    await ctx.reply("🔒 Owner only.").catch(() => {});
    return false;
  }
  return true;
};
const dollars = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const usage = (ctx, text) => ctx.reply(`အသုံးပြုပုံ: ${text}`);
const targetId = (ctx, args) => ctx.message.reply_to_message?.from?.id || Number(args[1]);

composer.command("ownerhelp", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  return ctx.reply([
    "🛠 Owner Controls",
    "/pool — payout pool ကြည့်ရန်",
    "/setwin <0-100> — base win rate",
    "/setlimit <min$> <max$> — bet limits",
    "/setcooldown <seconds> — cooldown",
    "/pausegame <slot|shan|all> <on|off>",
    "/user <id> — user balance ကြည့်ရန်",
    "/adjust <id> <amount$> — balance ပြင်ရန်",
    "/stats — bot/game statistics",
    "/resetcontrol — owner settings reset",
    "/maintenance on|off — maintenance mode",
    "/addpool <amount$> — payout pool ထည့်ရန်",
  ].join("\n"));
});

composer.command("pool", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  try {
    const [pool, settings] = await Promise.all([getPoolBalance(), getOwnerSettings()]);
    return ctx.reply([
      "📊 Pool Status",
      `Current Pool: ${dollars(pool)}`,
      `Win Rate: ${settings.winRate}%`,
      `Bet Limit: ${dollars(settings.minBet)} - ${dollars(settings.maxBet)}`,
      `Cooldown: ${(settings.cooldown / 1000).toFixed(1)}s`,
      `Slot: ${settings.pauseSlot ? "PAUSED" : "ON"} | Shan: ${settings.pauseShan ? "PAUSED" : "ON"}`,
    ].join("\n"));
  } catch (error) {
    logger.error(`Owner pool error: ${error.stack || error.message}`);
    return ctx.reply("❌ Pool status မရနိုင်ပါ။");
  }
});

composer.command("setwin", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const value = Number(ctx.message.text.trim().split(/\s+/)[1]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return usage(ctx, "/setwin <0-100>");
  await setOwnerSetting("winRate", value);
  logger.info(`Owner set win rate to ${value}%`);
  return ctx.reply(`✅ Base win rate: ${value}%`);
});

composer.command("setlimit", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const args = ctx.message.text.trim().split(/\s+/);
  const minBet = Math.floor(Number(args[1]) * 100);
  const maxBet = Math.floor(Number(args[2]) * 100);
  if (!Number.isFinite(minBet) || !Number.isFinite(maxBet) || minBet < 0 || maxBet <= minBet) {
    return usage(ctx, "/setlimit <min_dollars> <max_dollars>");
  }
  await setOwnerSetting("minBet", minBet);
  await setOwnerSetting("maxBet", maxBet);
  logger.info(`Owner set bet limits to ${minBet}/${maxBet} cents`);
  return ctx.reply(`✅ Bet limits: ${dollars(minBet)} - ${dollars(maxBet)}`);
});

composer.command("setcooldown", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const seconds = Number(ctx.message.text.trim().split(/\s+/)[1]);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return usage(ctx, "/setcooldown <seconds>");
  await setOwnerSetting("cooldown", Math.floor(seconds * 1000));
  logger.info(`Owner set cooldown to ${seconds}s`);
  return ctx.reply(`✅ Cooldown: ${seconds}s`);
});

composer.command("pausegame", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const args = ctx.message.text.trim().split(/\s+/);
  const game = String(args[1] || "").toLowerCase();
  const enabled = String(args[2] || "").toLowerCase();
  if (!["slot", "shan", "all"].includes(game) || !["on", "off"].includes(enabled)) {
    return usage(ctx, "/pausegame <slot|shan|all> <on|off>");
  }
  const value = enabled === "on";
  if (game === "slot" || game === "all") await setOwnerSetting("pauseSlot", value);
  if (game === "shan" || game === "all") await setOwnerSetting("pauseShan", value);
  return ctx.reply(`✅ ${game} is now ${value ? "paused" : "active"}.`);
});

composer.command("user", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const id = targetId(ctx, ctx.message.text.trim().split(/\s+/));
  if (!Number.isFinite(id)) return usage(ctx, "/user <telegram_id>");
  const user = await User.findOne({ id }).lean();
  if (!user) return ctx.reply("❌ User not found.");
  return ctx.reply(`👤 User: ${user.first_name || "User"}\nID: ${user.id}\nBalance: ${dollars(user.coins)}`);
});

composer.command("adjust", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const args = ctx.message.text.trim().split(/\s+/);
  const id = targetId(ctx, args);
  const amountIndex = ctx.message.reply_to_message ? 1 : 2;
  const amount = Number(args[amountIndex]);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(id) || !Number.isFinite(cents) || cents === 0) return usage(ctx, "/adjust <telegram_id> <amount_dollars>");
  const filter = cents < 0 ? { id, coins: { $gte: Math.abs(cents) } } : { id };
  const user = await User.findOneAndUpdate(filter, { $inc: { coins: cents } }, { new: true });
  if (!user) return ctx.reply(cents < 0 ? "❌ User not found or balance is too low." : "❌ User not found.");
  logger.info(`Owner adjusted user ${id} by ${cents} cents`);
  return ctx.reply(`✅ New balance for ${id}: ${dollars(user.coins)}`);
});

composer.command("stats", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const [users, balance, settings, pool] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: null, total: { $sum: "$coins" } } }]),
    getOwnerSettings(),
    getPoolBalance(),
  ]);
  return ctx.reply([
    "📈 Bot Stats",
    `Users: ${users}`,
    `User Balances: ${dollars(balance[0]?.total || 0)}`,
    `Payout Pool: ${dollars(pool)}`,
    `Win Rate: ${settings.winRate}%`,
    `Paused: slot=${settings.pauseSlot ? "yes" : "no"}, shan=${settings.pauseShan ? "yes" : "no"}`,
  ].join("\n"));
});

composer.command("resetcontrol", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  await resetOwnerSettings();
  logger.info("Owner reset game control settings");
  return ctx.reply(`✅ Controls reset. Win ${DEFAULTS.winRate}%, limits ${dollars(DEFAULTS.minBet)}-${dollars(DEFAULTS.maxBet)}, cooldown ${DEFAULTS.cooldown / 1000}s.`);
});

module.exports = composer;

