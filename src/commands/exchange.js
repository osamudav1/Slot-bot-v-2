const { Composer } = require("telegraf");
const User = require("../database/entity/user.entitiy");
const { getUser } = require("../modules/user.module");
const { getBalance, credit, debit } = require("../modules/slot-wallet.module");

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
const usage = "အသုံးပြုပုံ:\n/exchange slot <amount> — Waifu wallet မှ Slot wallet သို့\n/exchange waifu <amount> — Slot wallet မှ Waifu wallet သို့\nဥပမာ: /exchange slot 20";

composer.command("exchange", async (ctx) => {
  const [, direction, rawAmount] = String(ctx.message?.text || "").trim().split(/\s+/);
  const amount = parseAmount(rawAmount);
  const userId = Number(ctx.from.id);
  const target = String(direction || "").toLowerCase();
  if (!["slot", "waifu"].includes(target) || !amount) return ctx.reply(usage);

  try {
    await getUser({ id: userId, firstName: ctx.from.first_name });

    if (target === "slot") {
      // MongoDB is used here only to debit the Waifu wallet atomically.
      const updated = await User.findOneAndUpdate(
        { id: userId, coins: { $gte: amount } },
        { $inc: { coins: -amount } },
        { new: true }
      ).lean();
      if (!updated) return ctx.reply(`❌ Waifu wallet ထဲမှာ ${money(amount)} မလုံလောက်ပါ။`);
      try {
        await credit(userId, amount);
      } catch (error) {
        await User.updateOne({ id: userId }, { $inc: { coins: amount } }).catch(() => {});
        throw error;
      }
      return ctx.reply(`✅ ${money(amount)} ကို Slot wallet သို့ လွှဲပြီးပါပြီ။\n🏦 Waifu wallet: ${money(updated.coins)}\n🎰 Slot wallet: ${money(getBalance(userId))}`);
    }

    // Debit local Slot Wallet first; MongoDB is touched only to credit Waifu.
    const remaining = await debit(userId, amount);
    if (remaining === null) return ctx.reply(`❌ Slot wallet ထဲမှာ ${money(amount)} မလုံလောက်ပါ။`);
    try {
      const updated = await User.findOneAndUpdate(
        { id: userId },
        { $inc: { coins: amount } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      ).lean();
      return ctx.reply(`✅ ${money(amount)} ကို Waifu wallet သို့ လွှဲပြီးပါပြီ။\n🏦 Waifu wallet: ${money(updated.coins)}\n🎰 Slot wallet: ${money(remaining)}`);
    } catch (error) {
      await credit(userId, amount).catch(() => {});
      throw error;
    }
  } catch (error) {
    console.error("Exchange error:", error);
    return ctx.reply("❌ လွှဲပြောင်းမှု မအောင်မြင်ပါ။ ခဏနောက် ပြန်ကြိုးစားပါ။");
  }
});

module.exports = composer;
