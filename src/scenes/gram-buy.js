const { Scenes, Markup } = require("telegraf");
const { message } = require("telegraf/filters");
const logger = require("../logger");
const { getUser } = require("../modules/user.module");
const { createPurchase, verifyAndCreditPurchase } = require("../modules/gram-purchase.module");
const { MIN_USD_CENTS, USD_CENTS_PER_GRAM, formatUsd, formatGramNano, assertConfig, getPaymentConfig } = require("../modules/gram-payment.module");

const gramBuyScene = new Scenes.BaseScene("gram-buy");
const RATE_TEXT = `$${(USD_CENTS_PER_GRAM / 100).toLocaleString("en-US")} = 1 GRAM`;
const PRESET_AMOUNTS = [100000, 200000, 500000, 1000000];

function expiresText(date) {
  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Yangon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).replace(",", "");
}

function amountButtons() {
  return Markup.inlineKeyboard([
    PRESET_AMOUNTS.map((cents) => Markup.button.callback(formatUsd(cents), `gram_amount:${cents}`)),
    [Markup.button.callback("✏️ Custom Amount", "gram_custom"), Markup.button.callback("❌ Cancel", "gram_exit")],
  ]);
}

async function createInvoice(ctx, usdCents) {
  if (ctx.scene.state.creating) return ctx.answerCbQuery("Order ဖန်တီးနေပါတယ်။ ခဏစောင့်ပါ။");
  ctx.scene.state.creating = true;
  try {
    if (!Number.isSafeInteger(usdCents) || usdCents < MIN_USD_CENTS) return ctx.reply(`❌ အနည်းဆုံး ${formatUsd(MIN_USD_CENTS)} ကစပြီး ဝယ်လို့ရပါတယ်။`);
    const { ownerWallet } = await getPaymentConfig();
    const user = await getUser({ id: ctx.from.id, firstName: ctx.from.first_name });
    if (!user) return ctx.reply("❌ User account မတွေ့ပါ။ ထပ်ကြိုးစားပါ။");
    const purchase = await createPurchase({ userId: ctx.from.id, usdCents });
    ctx.scene.state.purchaseId = purchase.purchaseId;
    const invoice = [
      "💵 Top Up Your Balance",
      "",
      `Amount: ${formatUsd(purchase.usdCents)}`,
      `Rate - ${formatUsd(purchase.usdCents)} = ${formatGramNano(purchase.gramNano)} GRAM`,
      `You Receive: ${formatUsd(purchase.usdCents)}`,
      `Ton Send : ${formatGramNano(purchase.gramNano)} GRAM`,
      "",
      "🔗 Send To Wallet",
      ownerWallet,
      "",
      "🧾 Invoice ID",
      purchase.purchaseId,
      "",
      "🔜 Expires",
      expiresText(purchase.expiresAt),
      "",
      "━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n");
    const transferUrl = `ton://transfer/${ownerWallet}?amount=${encodeURIComponent(purchase.gramNano)}&text=${encodeURIComponent(purchase.comment)}`;
    const invoiceButtons = Markup.inlineKeyboard([
      [Markup.button.url("💎 Send GRAM", transferUrl)],
      [Markup.button.callback("✅ Verify Payment", `gram_verify:${purchase.purchaseId}`)],
      [Markup.button.callback("❌ Cancel", `gram_cancel:${purchase.purchaseId}`)],
    ]);
    if (ctx.callbackQuery) await ctx.editMessageText(invoice, invoiceButtons);
    else await ctx.reply(invoice, invoiceButtons);
  } catch (error) {
    logger.error(`GRAM purchase creation error: ${error.message}`);
    await ctx.reply("❌ Order ဖန်တီးရာမှာ အမှားဖြစ်ပါတယ်။ ထပ်ကြိုးစားပါ။");
  } finally {
    ctx.scene.state.creating = false;
  }
}

gramBuyScene.enter(async (ctx) => {
  try {
    const { ownerWallet, jettonMaster } = await getPaymentConfig();
    if (!ownerWallet) throw new Error("Owner GRAM wallet is not configured");
    const verificationWarning = jettonMaster
      ? ""
      : "\n\n⚠️ Owner က GRAM token master ကို မသတ်မှတ်ရသေးပါ။ Payment verify မလုပ်ခင် `/gramwallet` → Set GRAM Token Master လုပ်ပါ။";
    await ctx.reply(
      `💵 Top Up Your Balance\n\nRate: ${RATE_TEXT}\nMinimum: ${formatUsd(MIN_USD_CENTS)}${verificationWarning}\n\nဝယ်လိုတဲ့ amount ကို အောက်က button ကနေ ရွေးပါ။`,
      amountButtons(),
    );
  } catch (error) {
    logger.error(`GRAM buy configuration error: ${error.message}`);
    await ctx.reply("❌ GRAM payment ကို မပြင်ဆင်ရသေးပါ။ Owner ကို ဆက်သွယ်ပါ။");
    return ctx.scene.leave();
  }
});

gramBuyScene.action(/^gram_amount:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("Invoice ဖန်တီးနေပါတယ်...");
  return createInvoice(ctx, Number(ctx.match[1]));
});

gramBuyScene.action("gram_custom", async (ctx) => {
  ctx.scene.state.customAmount = true;
  await ctx.answerCbQuery();
  return ctx.editMessageText(`✏️ Custom Amount\n\nအနည်းဆုံး ${formatUsd(MIN_USD_CENTS)} ကစပြီး USD amount ကို ရိုက်ပို့ပါ။\nဥပမာ: 2000`, Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "gram_exit")]]));
});

gramBuyScene.on(message("text"), async (ctx) => {
  if (!ctx.scene.state.customAmount) return;
  const input = String(ctx.message.text || "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return ctx.reply("❌ Amount မမှန်ပါ။ ဥပမာ `2000` လို့ပို့ပါ။");
  const usdCents = Math.round(Number(input) * 100);
  ctx.scene.state.customAmount = false;
  return createInvoice(ctx, usdCents);
});

gramBuyScene.action(/^gram_verify:([a-f0-9-]+)$/i, async (ctx) => {
  const purchaseId = ctx.match[1];
  if (ctx.scene.state.purchaseId !== purchaseId) return ctx.answerCbQuery("ဒီ invoice ကို မတွေ့ပါ။");
  if (ctx.scene.state.verifying) return ctx.answerCbQuery("စစ်ဆေးနေပါတယ်။ ခဏစောင့်ပါ။");
  ctx.scene.state.verifying = true;
  await ctx.answerCbQuery("စစ်ဆေးနေပါတယ်...");
  try {
    const result = await verifyAndCreditPurchase({ purchaseId });
    if (result.status === "credited") {
      await ctx.editMessageText(`✅ Payment verified ပါပြီ။\n\nYou Receive: ${formatUsd(result.purchase.usdCents)}\nBalance ထဲ ထည့်ပြီးပါပြီ။`);
      return ctx.scene.leave();
    }
    if (result.status === "already_credited") {
      await ctx.editMessageText("✅ ဒီ payment ကို အရင်က credit လုပ်ပြီးသားပါ။ ထပ်မထည့်ပါဘူး။");
      return ctx.scene.leave();
    }
    if (result.status === "expired") {
      await ctx.editMessageText("⌛ ဒီ invoice သက်တမ်းကုန်သွားပါပြီ။ `/buys` နဲ့ invoice အသစ်လုပ်ပါ။");
      return ctx.scene.leave();
    }
    return ctx.answerCbQuery("Payment မတွေ့သေးပါ။ ခဏနောက်ထပ်စစ်ပါ။");
  } catch (error) {
    logger.error(`GRAM payment verification error: ${error.message}`);
    return ctx.reply("❌ Payment စစ်ဆေးရာမှာ အမှားဖြစ်ပါတယ်။ ခဏနားပြီး ထပ်ကြိုးစားပါ။");
  } finally {
    ctx.scene.state.verifying = false;
  }
});

gramBuyScene.action(/^gram_cancel:([a-f0-9-]+)$/, async (ctx) => {
  if (ctx.scene.state.purchaseId !== ctx.match[1]) return ctx.answerCbQuery("ဒီ invoice ကို မတွေ့ပါ။");
  await ctx.answerCbQuery("ဖျက်ပြီးပါပြီ။");
  await ctx.editMessageText("❌ Invoice ကို ဖျက်လိုက်ပါပြီ။");
  return ctx.scene.leave();
});

gramBuyScene.action("gram_exit", async (ctx) => {
  await ctx.answerCbQuery("ဖျက်ပြီးပါပြီ။");
  await ctx.editMessageText("❌ Top up ကို ဖျက်လိုက်ပါပြီ။");
  return ctx.scene.leave();
});

module.exports = gramBuyScene;
