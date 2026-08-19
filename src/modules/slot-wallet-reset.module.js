const crypto = require("crypto");
const User = require("../database/entity/user.entitiy");
const { listBalances, setBalance } = require("./slot-wallet.module");

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 100;
let migrationQueue = Promise.resolve();

const dollars = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const migrateOne = async ({ userId, cents, migrationId }) => {
  const amount = Number(cents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { userId, cents: 0, status: "skipped" };
  }

  const existing = await User.findOne({ id: Number(userId) })
    .select({ id: 1, slot_wallet_migration_id: 1 })
    .lean();

  if (existing?.slot_wallet_migration_id === migrationId) {
    await setBalance(userId, 0);
    return { userId, cents: amount, status: "already_migrated" };
  }

  if (!existing) {
    await User.create({
      id: Number(userId),
      coins: amount,
      slot_wallet: 0,
      slot_wallet_migration_id: migrationId,
    });
  } else {
    await User.updateOne(
      { id: Number(userId), slot_wallet_migration_id: { $ne: migrationId } },
      {
        $inc: { coins: amount },
        $set: { slot_wallet_migration_id: migrationId, slot_wallet: 0 },
      },
    );
  }

  await setBalance(userId, 0);
  return { userId, cents: amount, status: "migrated" };
};

const migrateSlotWalletsToWaifu = ({ onBatch } = {}) => {
  const run = migrationQueue.then(async () => {
    const migrationId = crypto.randomUUID();
    const candidates = listBalances().filter(({ cents }) => cents > 0);
    const results = [];

    for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
      const batch = candidates.slice(index, index + BATCH_SIZE);
      const batchResults = [];
      for (const candidate of batch) {
        try {
          batchResults.push(await migrateOne({ ...candidate, migrationId }));
        } catch (error) {
          batchResults.push({
            userId: candidate.userId,
            cents: candidate.cents,
            status: "failed",
            error: error.message,
          });
        }
      }
      results.push(...batchResults);
      if (typeof onBatch === "function") {
        await onBatch({
          batchNumber: Math.floor(index / BATCH_SIZE) + 1,
          completed: results.length,
          total: candidates.length,
          results: batchResults,
        });
      }
      if (index + BATCH_SIZE < candidates.length) await delay(BATCH_DELAY_MS);
    }

    return {
      migrationId,
      totalUsers: candidates.length,
      migratedUsers: results.filter((item) => ["migrated", "already_migrated"].includes(item.status)).length,
      failedUsers: results.filter((item) => item.status === "failed").length,
      totalCents: results
        .filter((item) => ["migrated", "already_migrated"].includes(item.status))
        .reduce((sum, item) => sum + item.cents, 0),
      results,
    };
  });

  migrationQueue = run.catch(() => {});
  return run;
};

module.exports = { BATCH_SIZE, dollars, migrateSlotWalletsToWaifu };

module.exports._format = dollars;
