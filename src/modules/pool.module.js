const Config = require("../database/entity/config.entity");

const POOL_KEY = "game_payout_pool";

const getPoolBalance = async () => {
  const config = await Config.findOne({ key: POOL_KEY });
  return config ? Number(config.value) : 0;
};

const addToPool = async (amount) => {
  await Config.findOneAndUpdate(
    { key: POOL_KEY },
    { $inc: { value: Number(amount) } },
    { upsert: true, new: true }
  );
};

const subtractFromPool = async (amount) => {
  await Config.findOneAndUpdate(
    { key: POOL_KEY },
    { $inc: { value: -Number(amount) } },
    { upsert: true, new: true }
  );
};

module.exports = {
  getPoolBalance,
  addToPool,
  subtractFromPool
};
