const { Composer, Markup } = require("telegraf");
const Config = require("../database/entity/config.entity");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const composer = new Composer();

// Helper to get bot switch status
const getBotStatus = async (botName) => {
  const config = await Config.findOne({ key: `bot_status_${botName}` });
  return config ? config.value : false;
};

// Helper to set bot switch status
const setBotStatus = async (botName, status) => {
  await Config.findOneAndUpdate(
    { key: `bot_status_${botName}` },
    { value: status },
    { upsert: true }
  );
};

// Daily limit helpers
const DAILY_LIMIT = 2;

const getTodayKey = (userId) => {
  const today = new Date().toISOString().slice(0, 10);
  return `gbuy_daily_${userId}_${today}`;
};

const getDailyCount = async (userId) => {
  const record = await Config.findOne({ key: getTodayKey(userId) });
  return record ? record.value : 0;
};

const incrementDailyCount = async (userId) => {
  const key = getTodayKey(userId);
  const current = await getDailyCount(userId);
  await Config.findOneAndUpdate(
    { key },
    { value: current + 1 },
    { upsert: true }
  );
};

// Owner Commands for on/off
const ownerBotControl = async (ctx, botName) => {
  const ownerId = process.env.OWNER_ID;
  if (ctx.from.id.toString() !== ownerId) return;

  const args = ctx.message.text.split(" ");
  const action = args[1]?.toLowerCase();

  if (action === "on") {
    await setBotStatus(botName, true);
    return ctx.reply(`✅ ${botName} Bot is now ON.`);
  } else if (action === "off") {
    await setBotStatus(botName, false);
    return ctx.reply(`✅ ${botName} Bot is now OFF.`);
  } else {
    const current = await getBotStatus(botName);
    return ctx.reply(`Usage: /${botName} on/off\nCurrent status: ${current ? "ON" : "OFF"}`);
  }
};

composer.command("guess", (ctx) => ownerBotControl(ctx, "guess"));
composer.command("catch", (ctx) => ownerBotControl(ctx, "catch"));
composer.command("grab", (ctx) => ownerBotControl(ctx, "grab"));

// /gbuy command
composer.command("gbuy", async (ctx) => {
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    const botUsername = ctx.botInfo.username;
    return ctx.reply(
      `⚠️ ဤ command ကို Bot DM တွင်သာ အသုံးပြုနိုင်ပါသည်။`,
      Markup.inlineKeyboard([
        [Markup.button.url("Bot DM သွားမည်", `https://t.me/${botUsername}?start=gbuy`)]
      ])
    );
  }

  const guessOn = await getBotStatus("guess");
  const catchOn = await getBotStatus("catch");
  const grabOn = await getBotStatus("grab");

  const buttons = [];
  const row1 = [];
  if (guessOn) row1.push(Markup.button.callback("Guess Bot", "gbuy_select_guess"));
  if (catchOn) row1.push(Markup.button.callback("Catch Bot", "gbuy_select_catch"));

  const row2 = [];
  if (grabOn) row2.push(Markup.button.callback("Grab Bot", "gbuy_select_grab"));

  if (row1.length > 0) buttons.push(row1);
  if (row2.length > 0) buttons.push(row2);

  const text = `Guess Bot မှကဒ်များသာလဲလှယ်နိုင်ပါသည် \n\nလဲလှယ်လိုသောBot Name Button ကိုနိပ်ပါ \n\nကဒ်များကြည့်ရန် /search ကိုအသုံးပြပါ`;

  await ctx.reply(text, Markup.inlineKeyboard(buttons));
});

// Callback handlers for buttons
composer.action(/^gbuy_select_(guess|catch|grab)$/, async (ctx) => {
  const botType = ctx.match[1];
  const botName = botType.charAt(0).toUpperCase() + botType.slice(1);

  const text = `${botName} လဲလှယ်လိုသောကဒ်id ပို့ပေးပါ \n\nသင့်တွင်လဲလှယ်ငွေလုံလောက်ရန်လိုပါသည် \n\nစျေးများကို /gmarket တွင်ကြည့်နိုင်ပါသည်`;

  await ctx.editMessageText(text, Markup.inlineKeyboard([
    [Markup.button.callback("Cancel", "gbuy_cancel")]
  ]));

  ctx.session = ctx.session || {};
  ctx.session.gbuy_step = "waiting_for_id";
  ctx.session.gbuy_type = botName;

  await ctx.answerCbQuery();
});

composer.action("gbuy_cancel", async (ctx) => {
  ctx.session = ctx.session || {};
  delete ctx.session.gbuy_step;
  delete ctx.session.gbuy_type;
  await ctx.editMessageText("Cancelled.");
  await ctx.answerCbQuery();
});

// Handle user sending ID
composer.on("message", async (ctx, next) => {
  if (!ctx.session || ctx.session.gbuy_step !== "waiting_for_id") return next();

  const requestId = ctx.message.text;
  const botType = ctx.session.gbuy_type;
  const user = await User.findOne({ id: ctx.from.id });
  const ownerId = process.env.OWNER_ID;
  const isOwner = ctx.from.id.toString() === ownerId;

  // Check daily limit before submitting (owner has no limit)
  if (!isOwner) {
    const count = await getDailyCount(ctx.from.id);
    if (count >= DAILY_LIMIT) {
      delete ctx.session.gbuy_step;
      delete ctx.session.gbuy_type;
      return ctx.reply(`⛔️ တစ်နေ့လျှင် ${DAILY_LIMIT} ကြိမ်သာ request တင်နိုင်ပါသည်။\n\nမနက်ဖြန် ထပ်မံသုံးနိုင်ပါမည်။`);
    }
  }

  // Clear session
  delete ctx.session.gbuy_step;
  delete ctx.session.gbuy_type;

  // Increment daily count for non-owner
  if (!isOwner) {
    await incrementDailyCount(ctx.from.id);
  }

  // Notify User
  const mention = `[${ctx.from.first_name}](tg://user?id=${ctx.from.id})`;
  await ctx.replyWithMarkdown(`Request တင်ပီးပါပီ ${mention}\n\nAdmin မှအတည်ပြုစစ်ဆေးပေးနေပါသည်`, {
    reply_to_message_id: ctx.message.message_id
  });

  // Notify Owner
  if (ownerId) {
    const ownerMsg = `📩 **New Exchange Request**\n\n` +
      `Type - ${botType} bot\n` +
      `User name - ${mention}\n` +
      `Display name - ${ctx.from.first_name}\n` +
      `User id - \`${ctx.from.id}\`\n` +
      `This user bank - ${user ? user.balance : 0} $\n` +
      `Request Id - \`${requestId}\``;

    await ctx.telegram.sendMessage(ownerId, ownerMsg, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("Reply to User", `gbuy_reply_${ctx.from.id}`)]
      ])
    });
  }
});

// Owner reply handler
composer.action(/^gbuy_reply_(\d+)$/, async (ctx) => {
  const targetUserId = ctx.match[1];
  const ownerId = process.env.OWNER_ID;
  if (ctx.from.id.toString() !== ownerId) return ctx.answerCbQuery("Not authorized");

  ctx.session = ctx.session || {};
  ctx.session.owner_reply_to = targetUserId;

  await ctx.reply(`Reply ပို့မည့်စာကို ရိုက်ထည့်ပေးပါ (User ID: ${targetUserId})`);
  await ctx.answerCbQuery();
});

// Handle owner sending reply text
composer.on("message", async (ctx, next) => {
  if (!ctx.session || !ctx.session.owner_reply_to) return next();

  const targetUserId = ctx.session.owner_reply_to;
  const replyText = ctx.message.text;

  delete ctx.session.owner_reply_to;

  try {
    await ctx.telegram.sendMessage(targetUserId, replyText);
    await ctx.reply("✅ User ဆီသို့ စာပို့ပြီးပါပြီ။");
  } catch (err) {
    logger.error("Failed to send reply to user: " + err.message);
    await ctx.reply("❌ စာပို့ရာတွင် အမှားအယွင်းရှိပါသည်။");
  }
});

module.exports = composer;
