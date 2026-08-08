const { getUser, setUser } = require("./user.module");
const { getString } = require("../lang/index");

const increaseBankAmount = async ({ ctx, increaseAmount }) => {
  if (increaseAmount < 0 || !increaseAmount) return ctx.reply(getString("DATABASE_LOCK"));
  const bankInfo = await getUser({ id: ctx?.botInfo.id });
  bankInfo.coins = bankInfo.coins + parseInt(increaseAmount);
  await setUser({ user: bankInfo });
};

const decreaseBankAmount = async ({ ctx, decreaseAmont }) => {
  if (decreaseAmont < 0 || !decreaseAmont) return ctx.reply(getString("DATABASE_LOCK"));
  const bankInfo = await getUser({ id: ctx?.botInfo.id });
  bankInfo.coins = bankInfo.coins - parseInt(decreaseAmont);
  await setUser({ user: bankInfo });
};

const getBankInfo = async ({ ctx }) => {
  const bankInfo = await getUser({ id: ctx?.botInfo.id });
  return bankInfo;
};

module.exports = { increaseBankAmount, getBankInfo, decreaseBankAmount };
