const { Composer, Markup } = require("telegraf");
const User = require("../database/entity/user.entitiy");
const { getUser } = require("../modules/user.module");
const { getBalance, credit, debit } = require("../modules/slot-wallet.module");

const composer = new Composer();
const pendingExchanges = new Map();

const money = (cents) => `$${(Number(cents || 0) / 100).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const parseAmount = (raw) => {
  if (!raw || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const ownerId = () => String(process.env.OWNER_ID || "").trim();
const isOwner = (ctx) => ownerId() && String(ctx.from?.id || "") === ownerId();

const usage =
  "အသုံးပြုပုံ:\n" +
  "/exchange <amount> — Slot wallet မှ Waifu wallet သို့ exchange request တင်ရန်\n" +
  "/exchange slot <amount> — Waifu wallet မှ Slot wallet သို့\n" +
  "/exchange waifu <amount> — Slot wallet မှ Waifu wallet သို့\n" +
  "ဥပမာ: /exchange 20";

// Slot wallet -> Waifu wallet exchange: debit first, then wait for owner approval.
const createExchangeRequest = async (ctx, amount) => {
  const userId = Number(ctx.from.id);
  const remaining = await debit(userId, amount);
  if (remaining === null) {
    return ctx.reply(`❌ Slot wallet ထဲမှာ ${money(amount)} မလုံလောက်ပါ။`);
  }

  const requestId = `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const request = {
    requestId,
    userId,
    amount,
    createdAt: Date.now(),
    userName: ctx.from.first_name || "User",
    username: ctx.from.username || "N/A",
    mention: `[${ctx.from.first_name || "User"}](tg://user?id=${userId})`,
  };
  pendingExchanges.set(requestId, request);

  const owner = ownerId();
  if (!owner) {
    pendingExchanges.delete(requestId);
    await credit(userId, amount);
    return ctx.reply("❌ Owner ID မသတ်မှတ်ရသေးပါ။ ငွေကို Slot wallet သို့ ပြန်ထည့်ပေးပြီးပါပြီ။");
  }

  try {
    await ctx.telegram.sendMessage(
      owner,
      `📩 <b>New Exchange Request</b>\n\n` +
        `Username: @${escapeHtml(request.username)}\n` +
        `Mention: ${request.mention}\n` +
        `ID: <code>${userId}</code>\n\n` +
        `Exchange Amount: <b>${money(amount)}</b>\n` +
        `Total Amount: <b>${money(amount)}</b>\n\n` +
        `Slot wallet လက်ကျန်: ${money(remaining)}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("✅ Confirmed", `exchange_confirm_${requestId}`),
            Markup.button.callback("❌ Cancel", `exchange_cancel_${requestId}`),
          ],
        ]),
      },
    );

    return ctx.reply(
      `✅ ${money(amount)} exchange request တင်ပြီးပါပြီ။\n` +
        `Owner အတည်ပြုပြီး forward message ပို့ပေးပါမည်။\n` +
        `🎰 Slot wallet လက်ကျန်: ${money(remaining)}`,
    );
  } catch (error) {
    pendingExchanges.delete(requestId);
    await credit(userId, amount).catch(() => {});
    throw error;
  }
};

composer.command("exchange", async (ctx) => {
  const args = String(ctx.message?.text || "").trim().split(/\s+/).slice(1);
  let direction = String(args[0] || "").toLowerCase();
  let rawAmount = args[1];

  // New shorthand: /exchange 20 means Slot wallet -> Waifu wallet.
  if (!rawAmount && parseAmount(args[0])) {
    direction = "waifu";
    rawAmount = args[0];
  }

  const amount = parseAmount(rawAmount);
  if (!amount || !["slot", "waifu"].includes(direction)) return ctx.reply(usage);

  try {
    await getUser({ id: Number(ctx.from.id), firstName: ctx.from.first_name });

    if (direction === "slot") {
      // Existing Waifu wallet -> Slot wallet flow remains unchanged.
      const updated = await User.findOneAndUpdate(
        { id: Number(ctx.from.id), coins: { $gte: amount } },
        { $inc: { coins: -amount } },
        { new: true },
      ).lean();
      if (!updated) return ctx.reply(`❌ Waifu wallet ထဲမှာ ${money(amount)} မလုံလောက်ပါ။`);
      try {
        await credit(ctx.from.id, amount);
      } catch (error) {
        await User.updateOne({ id: Number(ctx.from.id) }, { $inc: { coins: amount } }).catch(() => {});
        throw error;
      }
      return ctx.reply(
        `✅ ${money(amount)} ကို Slot wallet သို့ လွှဲပြီးပါပြီ။\n` +
          `🏦 Waifu wallet: ${money(updated.coins)}\n` +
          `🎰 Slot wallet: ${money(getBalance(ctx.from.id))}`,
      );
    }

    return createExchangeRequest(ctx, amount);
  } catch (error) {
    console.error("Exchange error:", error);
    return ctx.reply("❌ လွှဲပြောင်းမှု မအောင်မြင်ပါ။ ခဏနောက် ပြန်ကြိုးစားပါ။");
  }
});

composer.action(/^exchange_cancel_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Not authorized");
  const requestId = ctx.match[1];
  const request = pendingExchanges.get(requestId);
  if (!request) return ctx.answerCbQuery("Request မတွေ့တော့ပါ။", { show_alert: true });

  pendingExchanges.delete(requestId);
  await credit(request.userId, request.amount);
  await ctx.editMessageText(
    `❌ Exchange request cancelled\n\nUser ID: <code>${request.userId}</code>\nAmount: <b>${money(request.amount)}</b>\nSlot wallet သို့ ပြန်ထည့်ပြီးပါပြီ။`,
    { parse_mode: "HTML" },
  );
  await ctx.telegram.sendMessage(
    request.userId,
    `❌ ${money(request.amount)} exchange request ကို Owner မှ cancel လုပ်လိုက်ပါသည်။\n🎰 Slot wallet သို့ ပြန်ထည့်ပြီးပါပြီ။`,
  ).catch(() => {});
  return ctx.answerCbQuery("Cancelled");
});

composer.action(/^exchange_confirm_(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Not authorized");
  const requestId = ctx.match[1];
  const request = pendingExchanges.get(requestId);
  if (!request) return ctx.answerCbQuery("Request မတွေ့တော့ပါ။", { show_alert: true });

  request.status = "awaiting_forward";
  pendingExchanges.set(requestId, request);
  ctx.session = ctx.session || {};
  ctx.session.exchange_forward_request_id = requestId;

  await ctx.editMessageText(
    `✅ Exchange confirmed\n\nUser ID: <code>${request.userId}</code>\nAmount: <b>${money(request.amount)}</b>\n\n` +
      `အခု user ဆီပို့မည့် message ကို ဒီ chat ထဲ <b>forward</b> လုပ်ပေးပါ။`,
    { parse_mode: "HTML" },
  );
  return ctx.answerCbQuery("Confirmed");
});

// After confirmation, forward the owner's message to the requesting user's DM.
composer.on("message", async (ctx, next) => {
  const requestId = ctx.session?.exchange_forward_request_id;
  if (!requestId || !isOwner(ctx)) return next();

  const request = pendingExchanges.get(requestId);
  if (!request || request.status !== "awaiting_forward") {
    delete ctx.session.exchange_forward_request_id;
    return next();
  }

  if (!ctx.message?.message_id) return next();
  try {
    await ctx.telegram.forwardMessage(request.userId, ctx.chat.id, ctx.message.message_id);
    pendingExchanges.delete(requestId);
    delete ctx.session.exchange_forward_request_id;
    await ctx.reply("✅ Forward message ကို user bot DM ထဲ ပို့ပြီးပါပြီ။");
  } catch (error) {
    console.error("Exchange forward error:", error);
    await ctx.reply("❌ Forward message ပို့မရသေးပါ။ ထပ်မံ forward လုပ်ပေးပါ။");
  }
});

module.exports = composer;
