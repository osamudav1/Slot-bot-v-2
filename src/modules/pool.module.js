const Config = require("../database/entity/config.entity");

const POOL_KEY = "game_payout_pool";

const toCents = (amount) => {
  const value = Number(amount);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
};

const getPoolBalance = async () => {
  const config = await Config.findOne({ key: POOL_KEY });
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

  const current = await getPoolBalance();
  const next = current + cents;
  await Config.findOneAndUpdate(
    { key: POOL_KEY },
    { $set: { value: next } },
    { upsert: true, new: true }
  );
  return next;
};

const subtractFromPool = async (amount) => {
  const cents = toCents(amount);
  if (cents === 0) return getPoolBalance();

  // Clamp at zero instead of allowing a payout to create a negative pool.
  const current = await getPoolBalance();
  const next = Math.max(0, current - cents);
  await Config.findOneAndUpdate(
    { key: POOL_KEY },
    { $set: { value: next } },
    { upsert: true, new: true }
  );
  return next;
};

module.exports = {
  getPoolBalance,
  addToPool,
  subtractFromPool,
  POOL_KEY,
};
