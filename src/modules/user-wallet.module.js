const User = require("../database/entity/user.entitiy");

async function getUserGramWallet(userId) {
  const user = await User.findOne({ id: Number(userId) }).select({ gram_wallet: 1 }).lean();
  return user?.gram_wallet || null;
}

async function setUserGramWallet({ userId, wallet }) {
  return User.findOneAndUpdate(
    { id: Number(userId) },
    { $set: { gram_wallet: wallet } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

module.exports = { getUserGramWallet, setUserGramWallet };
