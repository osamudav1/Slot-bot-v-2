const crypto = require("crypto");
const Config = require("../database/entity/config.entity");

const USD_CENTS_PER_GRAM = Number(process.env.GRAM_USD_CENTS_PER_GRAM || 1000000);
const MIN_USD_CENTS = Number(process.env.GRAM_MIN_USD_CENTS || 100000);
const PAYMENT_TTL_MS = Number(process.env.GRAM_PAYMENT_TTL_MS || 30 * 60 * 1000);
const TONAPI_BASE_URL = process.env.TONAPI_BASE_URL || "https://tonapi.io";
const DEFAULT_OWNER_GRAM_WALLET = "UQA8B_qpkuc7SbzZF0_IxXMPqtp_bSz5z-7njMng6TnzLAZc";
const WALLET_CONFIG_KEY = "gram_owner_wallet";
const MASTER_CONFIG_KEY = "gram_jetton_master";

async function getPaymentConfig() {
  const [walletConfig, masterConfig] = await Promise.all([
    Config.findOne({ key: WALLET_CONFIG_KEY }).lean(),
    Config.findOne({ key: MASTER_CONFIG_KEY }).lean(),
  ]);
  return {
    ownerWallet: walletConfig?.value || process.env.OWNER_GRAM_WALLET || DEFAULT_OWNER_GRAM_WALLET,
    jettonMaster: masterConfig?.value || process.env.GRAM_JETTON_MASTER || null,
  };
}

async function savePaymentConfig({ ownerWallet, jettonMaster }) {
  const writes = [];
  if (ownerWallet !== undefined) writes.push(Config.findOneAndUpdate({ key: WALLET_CONFIG_KEY }, { $set: { value: ownerWallet } }, { upsert: true, new: true }));
  if (jettonMaster !== undefined) writes.push(Config.findOneAndUpdate({ key: MASTER_CONFIG_KEY }, { $set: { value: jettonMaster } }, { upsert: true, new: true }));
  await Promise.all(writes);
  return getPaymentConfig();
}

async function assertConfig() {
  const config = await getPaymentConfig();
  const missing = [];
  if (!config.ownerWallet) missing.push("owner GRAM wallet");
  if (!config.jettonMaster) missing.push("GRAM token master");
  if (missing.length) throw new Error(`Missing GRAM payment configuration: ${missing.join(", ")}`);
  return config;
}

function isTonAddress(value) {
  const address = String(value || "").trim();
  return /^(?:EQ|UQ)[A-Za-z0-9_-]{46}$/.test(address) || /^-?\d+:[0-9a-fA-F]{64}$/.test(address);
}

function calculateGramNano(usdCents) {
  if (!Number.isSafeInteger(usdCents) || usdCents < MIN_USD_CENTS) throw new Error("Amount must be at least the configured minimum");
  if (usdCents % 100 !== 0) throw new Error("Amount must be entered in whole dollars");
  const numerator = BigInt(usdCents) * 1000000000n;
  const denominator = BigInt(USD_CENTS_PER_GRAM);
  if (numerator % denominator !== 0n) throw new Error("Amount does not produce an exact GRAM amount");
  return (numerator / denominator).toString();
}

function formatUsd(cents) { return `$${(cents / 100).toFixed(2)}`; }
function formatGramNano(nano) {
  const value = BigInt(nano);
  const whole = value / 1000000000n;
  const fraction = (value % 1000000000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
function makePurchaseId() { return crypto.randomUUID(); }
function makeComment(purchaseId) { return `slotbot:${purchaseId}`; }

async function tonApiGet(path) {
  const response = await fetch(`${TONAPI_BASE_URL}${path}`, { headers: process.env.TONAPI_KEY ? { Authorization: `Bearer ${process.env.TONAPI_KEY}` } : {} });
  if (!response.ok) throw new Error(`TonAPI request failed: ${response.status}`);
  return response.json();
}

function normalizeAddress(address) { return String(address || "").trim(); }

async function findIncomingGramPayment({ comment, expectedNano }) {
  const config = await assertConfig();
  const encodedAddress = encodeURIComponent(config.ownerWallet);
  const data = await tonApiGet(`/v2/accounts/${encodedAddress}/jettons/history?limit=100`);
  const expected = BigInt(expectedNano);
  const transfers = Array.isArray(data) ? data : data.events || data.transfers || [];
  for (const transfer of transfers) {
    const eventId = transfer.event_id || transfer.eventId || transfer.transaction_hash || transfer.tx_hash;
    const amount = transfer.amount ?? transfer.jetton_amount ?? transfer.value;
    const transferComment = transfer.comment || transfer.payload || transfer.message || transfer.memo;
    const recipient = transfer.recipient?.address || transfer.destination?.address || transfer.to;
    const jetton = transfer.jetton?.address || transfer.jetton_master || transfer.jetton_master_address || transfer.asset?.address;
    const status = transfer.success ?? transfer.status;
    if (!eventId || amount == null || !transferComment || status === false || status === "failed") continue;
    if (normalizeAddress(recipient) !== normalizeAddress(config.ownerWallet)) continue;
    if (normalizeAddress(jetton) !== normalizeAddress(config.jettonMaster)) continue;
    if (String(transferComment).trim() !== comment) continue;
    if (BigInt(String(amount)) !== expected) continue;
    return { txHash: String(eventId), amountNano: String(amount), paidAt: new Date() };
  }
  return null;
}

module.exports = { USD_CENTS_PER_GRAM, MIN_USD_CENTS, PAYMENT_TTL_MS, WALLET_CONFIG_KEY, MASTER_CONFIG_KEY, getPaymentConfig, savePaymentConfig, assertConfig, isTonAddress, calculateGramNano, formatUsd, formatGramNano, makePurchaseId, makeComment, findIncomingGramPayment };
