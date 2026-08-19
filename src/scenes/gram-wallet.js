const { Scenes, Markup } = require("telegraf");
const { message } = require("telegraf/filters");
const logger = require("../logger");
const { isMaintenanceEnabled, setMaintenanceEnabled } = require("../modules/maintenance.module");
const { isOwner: matchesOwner } = require("../modules/owner.module");
const {
  getPaymentConfig,
  savePaymentConfig,
  isTonAddress,
  formatUsd,
  USD_CENTS_PER_GRAM,
  MIN_USD_CENTS,
} = require("../modules/gram-payment.module");

const gramWalletScene = new Scenes.BaseScene("gram-wallet");

function isOwner(ctx) {
  return matchesOwner(ctx) && ctx.chat?.type === "private";
}

function walletButtons() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛠 Maintenance ON / OFF", "gw_maintenance")],
    [Markup.button.callback("🔗 Connect Owner Wallet", "gw_connect_wallet")],
    [Markup.button.callback("🪙 Set GRAM Token Master", "gw_connect_token")],
    [Markup.button.callback("🔄 Refresh Status", "gw_status")],
    [Markup.button.callback("❌ Close", "gw_close")],
  ]);
}

async function statusText() {
  const config = await getPaymentConfig();
  const maintenance = await isMaintenanceEnabled();
  return [
    "⚙️ GRAM Wallet Settings + Maintenance",
    "",
    `Owner wallet: ${config.ownerWallet || "Not set"}`,
    `GRAM token master: ${config.jettonMaster || "Not set"}`,
    `Maintenance: ${maintenance ? "🔴 ON (users blocked)" : "🟢 OFF (bot open)"}`,
    `Rate: ${formatUsd(USD_CENTS_PER_GRAM)} = 1 GRAM`,
    `Minimum: ${formatUsd(MIN_USD_CENTS)}`,
    "",
    "Connect Wallet ကိုနှိပ်ပြီး wallet address ကို paste လုပ်ပါ။",
  ].join("\n");
}

gramWalletScene.enter(async (ctx) => {
  if (!isOwner(ctx)) return ctx.scene.leave();
  await ctx.reply(await statusText(), walletButtons());
});

gramWalletScene.action("gw_maintenance", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  await ctx.answerCbQuery();
  const enabled = await isMaintenanceEnabled();
  return ctx.editMessageText(
    `🛠 Maintenance Mode\n\nCurrent: ${enabled ? "🔴 ON - users cannot use the bot" : "🟢 OFF - bot is available"}`,
    Markup.inlineKeyboard([
      [Markup.button.callback(enabled ? "🟢 Turn OFF" : "🔴 Turn ON", `gw_toggle_maintenance:${enabled ? "off" : "on"}`)],
      [Markup.button.callback("⬅️ Back", "gw_status")],
    ]),
  );
});

gramWalletScene.action(/^gw_toggle_maintenance:(on|off)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  const enabled = ctx.match[1] === "on";
  await setMaintenanceEnabled(enabled);
  await ctx.answerCbQuery(enabled ? "Maintenance ON" : "Maintenance OFF");
  return ctx.editMessageText(
    `${enabled ? "🔴 Maintenance mode ON" : "🟢 Maintenance mode OFF"}\n\n${enabled ? "Users will see: Maintenance ပြုလုပ်နေသည်" : "Users can use the bot again."}`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "gw_status")]]),
  );
});

gramWalletScene.action("gw_status", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  await ctx.answerCbQuery("Status updated");
  return ctx.editMessageText(await statusText(), walletButtons());
});

gramWalletScene.action("gw_connect_wallet", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  ctx.scene.state.setting = "wallet";
  await ctx.answerCbQuery();
  return ctx.editMessageText(
    "🔗 Connect Owner Wallet\n\nWallet app ထဲက owner wallet address ကို copy လုပ်ပြီး ဒီ chat ထဲ paste လုပ်ပါ။\n\nဥပမာ: UQ... သို့မဟုတ် EQ...",
    Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "gw_cancel_input")]]),
  );
});

gramWalletScene.action("gw_connect_token", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  ctx.scene.state.setting = "token";
  await ctx.answerCbQuery();
  return ctx.editMessageText(
    "🪙 Set GRAM Token Master\n\nGRAM token ရဲ့ master contract address ကို copy လုပ်ပြီး ဒီ chat ထဲ paste လုပ်ပါ။",
    Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "gw_cancel_input")]]),
  );
});

gramWalletScene.on(message("text"), async (ctx) => {
  if (!isOwner(ctx) || !ctx.scene.state.setting) return;
  const value = String(ctx.message.text || "").trim();
  if (!isTonAddress(value)) return ctx.reply("❌ TON address format မမှန်ပါ။ EQ/UQ သို့မဟုတ် raw 0:<64 hex> address ကို paste လုပ်ပါ။");
  ctx.scene.state.pendingValue = value;
  return ctx.reply(
    `⚠️ Confirm ${ctx.scene.state.setting === "wallet" ? "Owner Wallet" : "GRAM Token Master"}\n\n\`${value}\`\n\nဒီ address မှန်ပါသလား?`,
    {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Confirm & Save", "gw_confirm_save")],
        [Markup.button.callback("🔁 Paste Again", `gw_connect_${ctx.scene.state.setting}`), Markup.button.callback("❌ Cancel", "gw_cancel_input")],
      ]),
    },
  );
});

gramWalletScene.action("gw_confirm_save", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  const { setting, pendingValue } = ctx.scene.state;
  if (!setting || !pendingValue) return ctx.answerCbQuery("Address မတွေ့ပါ။");
  await ctx.answerCbQuery("Saving...");
  try {
    const config = await savePaymentConfig(setting === "wallet" ? { ownerWallet: pendingValue } : { jettonMaster: pendingValue });
    ctx.scene.state.setting = null;
    ctx.scene.state.pendingValue = null;
    return ctx.editMessageText(
      `✅ ${setting === "wallet" ? "Owner wallet" : "GRAM token master"} ကို save လုပ်ပြီးပါပြီ။\n\nOwner wallet: ${config.ownerWallet || "Not set"}\nToken master: ${config.jettonMaster || "Not set"}`,
      walletButtons(),
    );
  } catch (error) {
    logger.error(`GRAM wallet save error: ${error.message}`);
    return ctx.reply("❌ Save လုပ်ရာမှာ အမှားဖြစ်ပါတယ်။ ထပ်ကြိုးစားပါ။");
  }
});

gramWalletScene.action(/^gw_connect_(wallet|token)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  ctx.scene.state.setting = ctx.match[1];
  ctx.scene.state.pendingValue = null;
  await ctx.answerCbQuery();
  return ctx.reply(`${ctx.match[1] === "wallet" ? "Owner wallet" : "GRAM token master"} address ကို paste လုပ်ပါ။`, Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "gw_cancel_input")]]));
});

gramWalletScene.action("gw_cancel_input", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  ctx.scene.state.setting = null;
  ctx.scene.state.pendingValue = null;
  await ctx.answerCbQuery("Cancelled");
  return ctx.editMessageText(await statusText(), walletButtons());
});

gramWalletScene.action("gw_close", async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery("Owner only");
  await ctx.answerCbQuery("Closed");
  await ctx.editMessageText("✅ GRAM wallet settings closed.");
  return ctx.scene.leave();
});

module.exports = gramWalletScene;
