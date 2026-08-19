const fs = require("fs");
const path = require("path");

const WALLET_FILE = path.join(__dirname, "../../slot_wallet.json");
const wallets = new Map();
let loaded = false;
let writeQueue = Promise.resolve();
let operationQueue = Promise.resolve();

const normalizeCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : 0;
};

const load = () => {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(WALLET_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
    for (const [id, amount] of Object.entries(raw || {})) {
      wallets.set(String(id), normalizeCents(amount));
    }
  } catch (error) {
    console.error("Slot Wallet load error:", error.message);
  }
};

const persist = () => {
  const snapshot = Object.fromEntries(wallets);
  writeQueue = writeQueue
    .then(async () => {
      const tempFile = `${WALLET_FILE}.tmp`;
      await fs.promises.writeFile(tempFile, JSON.stringify(snapshot, null, 2), "utf8");
      await fs.promises.rename(tempFile, WALLET_FILE);
    })
    .catch((error) => console.error("Slot Wallet save error:", error.message));
  return writeQueue;
};

const getBalance = (userId) => {
  load();
  return wallets.get(String(userId)) || 0;
};

const listBalances = () => {
  load();
  return Array.from(wallets.entries()).map(([userId, cents]) => ({ userId, cents }));
};

const runExclusive = (operation) => {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.catch(() => {});
  return result;
};

const setBalance = async (userId, cents) => runExclusive(async () => {
  load();
  wallets.set(String(userId), normalizeCents(cents));
  await persist();
  return getBalance(userId);
});

const credit = async (userId, cents) => runExclusive(async () => {
  load();
  wallets.set(String(userId), getBalance(userId) + normalizeCents(cents));
  await persist();
  return getBalance(userId);
});

const debit = async (userId, cents) => runExclusive(async () => {
  load();
  const amount = normalizeCents(cents);
  const current = getBalance(userId);
  if (current < amount) return null;
  wallets.set(String(userId), current - amount);
  await persist();
  return current - amount;
});

const hydrateFromMongo = async (User) => {
  load();
  if (fs.existsSync(WALLET_FILE) || wallets.size > 0) return;
  const users = await User.find({ slot_wallet: { $gt: 0 } }).select({ id: 1, slot_wallet: 1 }).lean();
  for (const user of users) wallets.set(String(user.id), normalizeCents(user.slot_wallet));
  await persist();
};

module.exports = { getBalance, listBalances, setBalance, credit, debit, hydrateFromMongo, WALLET_FILE };
