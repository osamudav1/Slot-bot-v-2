const { Composer } = require("telegraf");
const { debit, credit } = require("../modules/slot-wallet.module");
const { getString } = require("../lang/index");
const { getOwnerSettings } = require("../modules/owner-settings.module");
const { isOwner } = require("../modules/owner.module");
const logger = require("../logger");

const DARTS_BULLSEYE_MULTIPLIER = 2.5;
const DARTS_RING_MULTIPLIER = 0.5;
const DARTS_EMOJI = "🎯";

const formatMoney = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

const dartsHandler = async (ctx) => {
  const userId = ctx.from.id;
  const args = (ctx.message?.text || "").trim().split(/\s+/);
  const betAmount = Math.floor(Number(args[1]) * 100);

  if (!Number.isFinite(betAmount) || betAmount <= 0) {
    return ctx.reply("အသုံးပြုပုံ: /darts <ထိုးကြေး>\nဥပမာ: /darts 100");
  }

  let ownerSettings;
  try {
    ownerSettings = await getOwnerSettings();
  } catch (error) {
    logger.error(`Darts settings error: ${error.message}`);
    ownerSettings = { minBet: 500, maxBet: 10000, pauseShan: false };
  }

  if (ownerSettings.pauseShan && !isOwner(ctx)) {
    return ctx.reply("🛠 Darts game is temporarily paused by owner.");
  }
  if (betAmount < ownerSettings.minBet) {
    return ctx.reply(`🔴 အနည်းဆုံး ${formatMoney(ownerSettings.minBet)} လောင်းရပါမည်။`);
  }
  if (betAmount > ownerSettings.maxBet) {
    return ctx.reply(`🔴 အများဆုံး ${formatMoney(ownerSettings.maxBet)} ထိသာ လောင်းနိုင်ပါသည်။`);
  }

  let charged = false;
  let dartsMessage = null;
  try {
    const remainingBalance = await debit(userId, betAmount);
    if (remainingBalance === null) return ctx.reply(getString("NO_BALANCE"));
    charged = true;

    dartsMessage = await ctx.telegram.sendDice(ctx.chat.id, {
      emoji: DARTS_EMOJI,
      reply_to_message_id: ctx.message.message_id,
    });

    const result = Number(dartsMessage.dice?.value);
    if (!Number.isInteger(result) || result < 1 || result > 6) {
      throw new Error(`Invalid Telegram darts result: ${result}`);
    }

    const isBullseye = result === 6;
    const isRingHit = result >= 2 && result <= 5;
    const multiplier = isBullseye
      ? DARTS_BULLSEYE_MULTIPLIER
      : isRingHit
        ? DARTS_RING_MULTIPLIER
        : 0;
    const payout = Math.floor(betAmount * multiplier);
    if (payout > 0) await credit(userId, payout);

    const status = isBullseye ? "Bullseye" : isRingHit ? "Ring" : "Miss";
    return ctx.telegram.sendMessage(ctx.chat.id,
      `🎯 DARTS RESULT\n\n` +
      `Bet - ${formatMoney(betAmount)}\n\n` +
      `Result - ${result} [${status}]\n` +
      `Payout - ${formatMoney(payout)} [${multiplier}x]`,
      { reply_to_message_id: dartsMessage.message_id },
    );
  } catch (error) {
    logger.error(`Darts handler error: ${error.stack || error.message}`);
    if (charged) await credit(userId, betAmount).catch((refundError) =>
      logger.error(`Darts refund error: ${refundError.message}`)
    );
    if (dartsMessage) {
      return ctx.telegram.sendMessage(ctx.chat.id, getString("DATABASE_LOCK"), {
        reply_to_message_id: dartsMessage.message_id,
      }).catch(() => {});
    }
    return ctx.reply(getString("DATABASE_LOCK")).catch(() => {});
  }
};

const composer = new Composer();
composer.command("darts", dartsHandler);

module.exports = composer;
module.exports.DARTS_BULLSEYE_MULTIPLIER = DARTS_BULLSEYE_MULTIPLIER;
module.exports.DARTS_RING_MULTIPLIER = DARTS_RING_MULTIPLIER;
module.exports.dartsHandler = dartsHandler;
