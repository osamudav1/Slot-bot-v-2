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

const { isOwner } = require("../modules/owner.module");
const { getBalance, credit, debit } = require("../modules/slot-wallet.module");

const composer = new Composer();

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
    "/adjust <id> <amount$> — Slot wallet ပြင်ရန်",
    "Reply +amount / -amount — Slot wallet ပြင်ရန် (owner only)",
    "/stats — bot/game statistics",
    "/resetcontrol — owner settings reset",
    "/reset — မသုံးရန် (Slot wallet data မဖျက်ပါ)",
    "/maintenance on|off — maintenance mode",
    "/addpool <amount$> — payout pool ထည့်ရန်",
  ].join("\n"));
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
  return ctx.reply(`👤 User: ${user.first_name || "User"}\nID: ${user.id}\nSlot Balance: ${dollars(await getBalance(id))}`);
});

composer.command("adjust", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const args = ctx.message.text.trim().split(/\s+/);
  const id = targetId(ctx, args);
  const amountIndex = ctx.message.reply_to_message ? 1 : 2;
  const amount = Number(args[amountIndex]);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(id) || !Number.isFinite(cents) || cents === 0) return usage(ctx, "/adjust <telegram_id> <amount_dollars>");
  const balance = cents > 0
    ? await credit(id, cents)
    : await debit(id, Math.abs(cents));
  if (balance === null) return ctx.reply("❌ User not found or Slot balance is too low.");
  logger.info(`Owner adjusted Slot wallet ${id} by ${cents} cents`);
  return ctx.reply(`✅ New Slot balance for ${id}: ${dollars(balance)}`);
});

// Owner-only quick Slot wallet adjustment. Reply to any user's message and send
// +amount or -amount, for example +10 or -5. The owner can also reply to their
// own message to adjust their own Slot wallet.
composer.on("message", async (ctx, next) => {
  if (!isOwner(ctx)) return next();

  const repliedMessage = ctx.message?.reply_to_message;
  const rawText = String(ctx.message?.text || "").trim();
  const match = rawText.match(/^([+-])\s*(\d+(?:\.\d{1,2})?)$/);
  if (!repliedMessage || !match) return next();

  const targetId = Number(repliedMessage.from?.id);
  const amountDollars = Number(match[2]);
  const cents = Math.round(amountDollars * 100);
  if (!Number.isSafeInteger(targetId) || targetId <= 0 || !Number.isSafeInteger(cents) || cents <= 0) {
    return ctx.reply("❌ Amount မမှန်ပါ။ ဥပမာ +10 သို့မဟုတ် -5");
  }

  try {
    const signedAmount = match[1] === "+" ? cents : -cents;
    const balance = signedAmount > 0
      ? await credit(targetId, signedAmount)
      : await debit(targetId, cents);

    if (balance === null) {
      return ctx.reply(`❌ Slot wallet လက်ကျန် မလုံလောက်ပါ။\nလက်ကျန်: ${dollars(await getBalance(targetId))}`);
    }

    logger.info(`Owner adjusted Slot wallet ${targetId} by ${signedAmount} cents`);
    return ctx.reply(
      `✅ Slot wallet ပြင်ပြီးပါပြီ။\n` +
      `User ID: ${targetId}\n` +
      `ပြောင်းလဲမှု: ${signedAmount > 0 ? "+" : "-"}${dollars(cents)}\n` +
      `လက်ကျန်: ${dollars(balance)}`,
    );
  } catch (error) {
    logger.error(`Owner Slot wallet adjustment error: ${error.message}`);
    return ctx.reply("❌ Slot wallet ပြင်ရာတွင် အမှားဖြစ်ပါသည်။");
  }
});

composer.command("stats", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  const [users, balance, settings, pool] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: null, total: { $sum: "$slot_wallet" } } }]),
    getOwnerSettings(),
    getPoolBalance(),
  ]);
  return ctx.reply([
    "📈 Bot Stats",
    `Users: ${users}`,
    `Slot Wallet Balances: ${dollars(balance[0]?.total || 0)}`,
    `Payout Pool: ${dollars(pool)}`,
    `Win Rate: ${settings.winRate}%`,
    `Paused: slot=${settings.pauseSlot ? "yes" : "no"}, shan=${settings.pauseShan ? "yes" : "no"}`,
  ].join("\n"));
});

composer.command("reset", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  return ctx.reply("ℹ️ MongoDB Slot Wallet ကို restart/reset လုပ်လည်း data မပျောက်ပါ။ Waifu migration/reset ကို ပိတ်ထားပါသည်။");
});

composer.command("resetcontrol", async (ctx) => {
  if (!(await ownerOnly(ctx))) return;
  await resetOwnerSettings();
  global.autoRegister = true;
  logger.info("Owner reset game control settings and enabled auto registration");
  return ctx.reply(`✅ Controls reset. Auto Register ON. Win ${DEFAULTS.winRate}%, limits ${dollars(DEFAULTS.minBet)}-${dollars(DEFAULTS.maxBet)}, cooldown ${DEFAULTS.cooldown / 1000}s.`);
});

module.exports = composer;

