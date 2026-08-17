const Config = require("../database/entity/config.entity");

const KEYS = {
  winRate: "owner_slot_win_rate",
  minBet: "owner_game_min_bet_cents",
  maxBet: "owner_game_max_bet_cents",
  cooldown: "owner_game_cooldown_ms",
  pauseSlot: "owner_pause_slot",
  pauseShan: "owner_pause_shan",
};

const DEFAULTS = {
  winRate: 36,
  minBet: 2000,
  maxBet: 50000,
  cooldown: 8000,
  pauseSlot: false,
  pauseShan: false,
};

let cache = null;
let loading = null;

const normalize = (key, value) => {
  if (key === "pauseSlot" || key === "pauseShan") return Boolean(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : DEFAULTS[key];
};

const loadSettings = async () => {
  if (cache) return cache;
  if (loading) return loading;
  loading = Config.find({ key: { $in: Object.values(KEYS) } }).lean().then((rows) => {
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    cache = Object.fromEntries(Object.keys(KEYS).map((name) => [name, normalize(name, byKey.get(KEYS[name]) ?? DEFAULTS[name])]));
    loading = null;
    return cache;
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
};

const getOwnerSettings = () => loadSettings();

const setOwnerSetting = async (name, value) => {
  if (!Object.prototype.hasOwnProperty.call(KEYS, name)) throw new Error("Unknown owner setting");
  const normalized = normalize(name, value);
  await Config.findOneAndUpdate(
    { key: KEYS[name] },
    { $set: { value: normalized } },
    { upsert: true, new: true }
  );
  if (!cache) await loadSettings();
  cache[name] = normalized;
  return normalized;
};

const resetOwnerSettings = async () => {
  for (const [name, value] of Object.entries(DEFAULTS)) await setOwnerSetting(name, value);
  return cache;
};

module.exports = { DEFAULTS, getOwnerSettings, setOwnerSetting, resetOwnerSettings };
