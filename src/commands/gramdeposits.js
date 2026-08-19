const { Composer, Markup } = require("telegraf");
const GramPurchase = require("../database/entity/gram-purchase.entity");
const { isOwner: matchesOwner } = require("../modules/owner.module");
const composer = new Composer();

function isOwner(ctx) {
  return matchesOwner(ctx) && ctx.chat?.type === "private";
}

async function renderDeposits(ctx) {
  const records = await GramPurchase.find().sort({ createdAt: -1 }).limit(10).lean();
  if (!records.length) return ctx.reply("📥 GRAM deposits မရှိသေးပါ။");
  const text = records.map((record, index) => [
    `${index + 1}. ${record.status === "credited" ? "✅" : "⏳"} ${record.status.toUpperCase()}`,
    `User: ${record.userId}`,
    `Amount: $${(record.usdCents / 100).toFixed(2)}`,
    `GRAM: ${record.gramNano}`,
    `Wallet: ${record.senderWallet}`,
    `Invoice: ${record.purchaseId}`,
    `TX: ${record.txHash || "not detected"}`,
  ].join("\n")).join("\n\n");
  return ctx.reply(`📥 Recent GRAM Deposits\n\n${text}`, Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "gramdeposits_refresh")]]));
}

composer.command("gramdeposits", async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply("🔒 Owner DM only.");
  return renderDeposits(ctx);
});

composer.action("gramdeposits_refresh", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  await ctx.answerCbQuery("Updated");
  const records = await GramPurchase.find().sort({ createdAt: -1 }).limit(10).lean();
  const text = records.length ? records.map((record, index) => `${index + 1}. ${record.status} | user ${record.userId} | $${(record.usdCents / 100).toFixed(2)} | ${record.senderWallet}`).join("\n") : "No deposits";
  return ctx.editMessageText(`📥 Recent GRAM Deposits\n\n${text}`, Markup.inlineKeyboard([[Markup.button.callback("🔄 Refresh", "gramdeposits_refresh")]]));
});

module.exports = composer;
