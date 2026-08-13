const { Composer } = require("telegraf");
const { getPaymentConfig, savePaymentConfig, isTonAddress, formatUsd, USD_CENTS_PER_GRAM, MIN_USD_CENTS } = require("../modules/gram-payment.module");

const composer = new Composer();

function isOwner(ctx) {
  return String(ctx.from?.id) === String(process.env.OWNER_ID) && ctx.chat?.type === "private";
}

function help() {
  return [
    "Owner GRAM wallet commands:",
    "/gramwallet - current settings",
    "/gramwallet set <owner_wallet_address>",
    "/gramwallet token <gram_jetton_master_address>",
    "",
    `Rate: ${formatUsd(USD_CENTS_PER_GRAM)} = 1 GRAM`,
    `Minimum: ${formatUsd(MIN_USD_CENTS)}`,
  ].join("\n");
}

composer.command("gramwallet", async (ctx) => {
  if (!isOwner(ctx)) return ctx.reply("🔒 Owner DM only.");
  const args = ctx.message.text.trim().split(/\s+/);
  const action = (args[1] || "").toLowerCase();
  if (!action) {
    const config = await getPaymentConfig();
    return ctx.reply(`${help()}\n\nCurrent owner wallet: ${config.ownerWallet || "Not set"}\nGRAM token master: ${config.jettonMaster || "Not set"}`);
  }
  if (!["set", "token"].includes(action) || !args[2]) return ctx.reply(help());
  const value = args[2].trim();
  if (!isTonAddress(value)) return ctx.reply("❌ TON address format မမှန်ပါ။ EQ/UQ သို့မဟုတ် raw 0:<64 hex> address သုံးပါ။");
  const config = await savePaymentConfig(action === "set" ? { ownerWallet: value } : { jettonMaster: value });
  return ctx.reply(`✅ ${action === "set" ? "Owner GRAM wallet" : "GRAM token master"} သိမ်းပြီးပါပြီ။\n\nOwner wallet: ${config.ownerWallet || "Not set"}\nToken master: ${config.jettonMaster || "Not set"}`);
});

module.exports = composer;
