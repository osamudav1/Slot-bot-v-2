const Config = require("../database/entity/config.entity");

const POOL_KEY = "game_payout_pool";

const toCents = (amount) => {
  const value = Number(amount);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

const getPoolBalance = async () => {
  const config = await Config.findOne({ key: POOL_KEY }).lean();
  const balance = toCents(config?.value);

  // Repair missing, negative, string, or otherwise invalid legacy values.
  if (!config) {
    await Config.updateOne(
      { key: POOL_KEY },
      { $setOnInsert: { value: 0 } },
      { upsert: true }
    );
  } else if (Number(config.value) !== balance) {
    await Config.updateOne({ key: POOL_KEY }, { $set: { value: balance } });
  }

  return balance;
};

const addToPool = async (amount) => {
  const cents = toCents(amount);
  if (cents === 0) return getPoolBalance();

  // Ensure legacy/corrupt values are normalized before the atomic increment.
  await getPoolBalance();
  const updated = await Config.findOneAndUpdate(
    { key: POOL_KEY },
    { $inc: { value: cents } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return toCents(updated?.value);
};

const subtractFromPool = async (amount) => {
  const cents = toCents(amount);
  if (cents === 0) return getPoolBalance();

  await getPoolBalance();
  // Atomic subtraction with a zero floor. If the available pool is lower than
  // the requested profit, the stored balance remains unchanged at zero.
  const updated = await Config.findOneAndUpdate(
    {
      key: POOL_KEY,
      $expr: {
        $gte: [
          { $convert: { input: "$value", to: "long", onError: 0, onNull: 0 } },
          cents,
        ],
      },
    },
    { $inc: { value: -cents } },
    { new: true }
  ).lean();

  if (updated) return toCents(updated.value);
  return getPoolBalance();
};

module.exports = {
  getPoolBalance,
  addToPool,
  subtractFromPool,
  POOL_KEY,
};
