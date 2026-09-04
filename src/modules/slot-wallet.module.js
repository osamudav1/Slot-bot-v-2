const fs = require("fs");
const path = require("path");
const User = require("../database/entity/user.entitiy");
const LEGACY_WALLET_FILE = path.join(__dirname, "../../slot_wallet.json");
const LEGACY_MIGRATION_ID = "slot-wallet-mongodb-v1";

const normalizeCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : 0;
};

const getBalance = async (userId) => {
  const user = await User.findOne({ id: Number(userId) }).select({ slot_wallet: 1 }).lean();
  return normalizeCents(user?.slot_wallet);
};

const listBalances = async () => {
  const users = await User.find({}).select({ id: 1, slot_wallet: 1 }).lean();
  return users.map((user) => ({ userId: String(user.id), cents: normalizeCents(user.slot_wallet) }));
};

const setBalance = async (userId, cents) => {
  const updated = await User.findOneAndUpdate(
    { id: Number(userId) },
    { $set: { slot_wallet: normalizeCents(cents) } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).select({ slot_wallet: 1 }).lean();
  return normalizeCents(updated?.slot_wallet);
};

const credit = async (userId, cents) => {
  const updated = await User.findOneAndUpdate(
    { id: Number(userId) },
    { $inc: { slot_wallet: normalizeCents(cents) } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).select({ slot_wallet: 1 }).lean();
  return normalizeCents(updated?.slot_wallet);
};

const debit = async (userId, cents) => {
  const amount = normalizeCents(cents);
  const updated = await User.findOneAndUpdate(
    { id: Number(userId), slot_wallet: { $gte: amount } },
    { $inc: { slot_wallet: -amount } },
    { new: true },
  ).select({ slot_wallet: 1 }).lean();
  return updated ? normalizeCents(updated.slot_wallet) : null;
};

const migrateLegacyWallet = async () => {
  if (!fs.existsSync(LEGACY_WALLET_FILE)) return { migrated: 0, skipped: 0 };
  let raw;
  try {
    raw = JSON.parse(await fs.promises.readFile(LEGACY_WALLET_FILE, "utf8"));
  } catch (error) {
    throw new Error(`Legacy Slot wallet migration read failed: ${error.message}`);
  }

  let migrated = 0;
  let skipped = 0;
  for (const [userId, amount] of Object.entries(raw || {})) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      skipped += 1;
      continue;
    }
    const result = await User.updateOne(
      { id, slot_wallet_migration_id: { $ne: LEGACY_MIGRATION_ID } },
      {
        $set: {
          slot_wallet: normalizeCents(amount),
          slot_wallet_migration_id: LEGACY_MIGRATION_ID,
        },
        $setOnInsert: { id },
      },
      { upsert: true },
    );
    if (result.modifiedCount || result.upsertedCount) migrated += 1;
    else skipped += 1;
  }
  return { migrated, skipped };
};

// Kept for compatibility with older imports. Startup must never clear balances.
const clearAll = async () => true;
const hydrateFromMongo = async () => true;

module.exports = {
  getBalance,
  listBalances,
  setBalance,
  credit,
  debit,
  clearAll,
  hydrateFromMongo,
  migrateLegacyWallet,
};
