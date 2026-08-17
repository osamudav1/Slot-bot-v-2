const { Composer } = require("telegraf");
const User = require("../database/entity/user.entitiy");
const { getUser } = require("../modules/user.module");

const composer = new Composer();

const money = (cents) => `$${(Number(cents || 0) / 100).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const parseAmount = (raw) => {
  if (!raw || !/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const amount = Math.round(Number(raw) * 100);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

const usage = "အသုံးပြုပုံ:\n/exchange slot <amount>  — Waifu wallet မှ Slot wallet သို့\n/exchange waifu <amount> — Slot wallet မှ Waifu wallet သို့\nဥပမာ: /exchange slot 2000";

composer.command("exchange", async (ctx) => {
  const [, direction, rawAmount] = String(ctx.message?.text || "").trim().split(/\s+/);
  const amount = parseAmount(rawAmount);
  const userId = Number(ctx.from.id);

  if (!["slot", "waifu"].includes(String(direction || "").toLowerCase()) || !amount) {
    return ctx.reply(usage);
  }

  const isToSlot = String(direction).toLowerCase() === "slot";
  const sourceField = isToSlot ? "coins" : "slot_wallet";
  const targetField = isToSlot ? "slot_wallet" : "coins";

  try {
    await getUser({ id: userId, firstName: ctx.from.first_name });

    // The balance predicate and both $inc operations execute atomically in MongoDB.
    // Concurrent exchanges therefore cannot spend the same source funds twice.
    const updated = await User.findOneAndUpdate(
      { id: userId, [sourceField]: { $gte: amount } },
      { $inc: { [sourceField]: -amount, [targetField]: amount } },
      { new: true, setDefaultsOnInsert: true }
    ).lean();

    if (!updated) {
      const walletName = isToSlot ? "Waifu" : "Slot";
      return ctx.reply(`❌ ${walletName} wallet ထဲမှာ ${money(amount)} မလုံလောက်ပါ။`);
    }

    return ctx.reply(
      `✅ ${money(amount)} ကို ${isToSlot ? "Slot" : "Waifu"} wallet သို့ လွှဲပြီးပါပြီ။\n` +
      `🏦 Waifu wallet: ${money(updated.coins)}\n` +
      `🎰 Slot wallet: ${money(updated.slot_wallet)}`
    );
  } catch (error) {
    console.error("Exchange error:", error);
    return ctx.reply("❌ လွှဲပြောင်းမှု မအောင်မြင်ပါ။ ခဏနောက် ပြန်ကြိုးစားပါ။");
  }
});

module.exports = composer;
