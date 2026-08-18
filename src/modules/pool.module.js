const Config = require("../database/entity/config.entity");

const POOL_KEY = "game_payout_pool";

const toCents = (amount) => {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
};

const numericValue = {
  $convert: {
    input: { $ifNull: ["$value", 0] },
    to: "long",
    onError: 0,
    onNull: 0,
  },
};

const getPoolBalance = async () => {
  const config = await Config.findOne({ key: POOL_KEY }).lean();
  const balance = toCents(config?.value);

  // Repair legacy negative/corrupt values so every caller sees a safe balance.
  if (config && Number(config.value) !== balance) {
    await Config.updateOne({ key: POOL_KEY }, { $set: { value: balance } });
  }

  return balance;
};

const addToPool = async (amount) => {
  const cents = toCents(amount);
  if (cents === 0) return getPoolBalance();

  // Atomic increment: concurrent losses are accumulated instead of overwriting one another.
  const updated = await Config.findOneAndUpdate(
    { key: POOL_KEY },
    [{ $set: { value: { $add: [numericValue, cents] } } }],
    { upsert: true, new: true }
  );
  return toCents(updated?.value);
};

const subtractFromPool = async (amount) => {
  const cents = toCents(amount);
  if (cents === 0) return getPoolBalance();

  // Atomic subtraction with a zero floor: concurrent wins cannot create a negative pool.
  const updated = await Config.findOneAndUpdate(
    { key: POOL_KEY },
    [{ $set: { value: { $max: [0, { $subtract: [numericValue, cents] }] } } }],
    { upsert: true, new: true }
  );
  return toCents(updated?.value);
};

module.exports = {
  getPoolBalance,
  addToPool,
  subtractFromPool,
  POOL_KEY,
};
