const Config = require("../database/entity/config.entity");

const MAINTENANCE_KEY = "bot_maintenance_mode";

async function isMaintenanceEnabled() {
  const config = await Config.findOne({ key: MAINTENANCE_KEY }).lean();
  return config?.value === true;
}

async function setMaintenanceEnabled(enabled) {
  await Config.findOneAndUpdate(
    { key: MAINTENANCE_KEY },
    { $set: { value: Boolean(enabled) } },
    { upsert: true, new: true },
  );
  return Boolean(enabled);
}

module.exports = { MAINTENANCE_KEY, isMaintenanceEnabled, setMaintenanceEnabled };
