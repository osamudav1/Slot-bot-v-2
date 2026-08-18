const User = require("../database/entity/user.entitiy");
const { getString } = require("../lang/index");

const updateBankAmount = async ({ ctx, amount }) => {
  const cents = Number(amount);
  const bankId = Number(ctx?.botInfo?.id);
  if (!Number.isSafeInteger(bankId) || !Number.isFinite(cents) || cents === 0) {
    throw new Error("Invalid bank update");
  }

  const updated = await User.findOneAndUpdate(
    { id: bankId },
    { $inc: { coins: cents } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!updated) throw new Error("Bank update failed");
  return updated;
};

const increaseBankAmount = async ({ ctx, increaseAmount }) => {
  if (increaseAmount < 0 || !increaseAmount) return ctx.reply(getString("DATABASE_LOCK"));
  return updateBankAmount({ ctx, amount: parseInt(increaseAmount, 10) });
};

const decreaseBankAmount = async ({ ctx, decreaseAmont }) => {
  if (decreaseAmont < 0 || !decreaseAmont) return ctx.reply(getString("DATABASE_LOCK"));
  return updateBankAmount({ ctx, amount: -parseInt(decreaseAmont, 10) });
};

const getBankInfo = async ({ ctx }) => {
  const bankId = Number(ctx?.botInfo?.id);
  return User.findOne({ id: bankId });
};

module.exports = { increaseBankAmount, getBankInfo, decreaseBankAmount };
