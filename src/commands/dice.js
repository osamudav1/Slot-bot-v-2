const { Composer } = require("telegraf");
const { debit, credit } = require("../modules/slot-wallet.module");
const { getString } = require("../lang/index");
const { getOwnerSettings } = require("../modules/owner-settings.module");
const { isOwner } = require("../modules/owner.module");
const logger = require("../logger");

const DICE_PAYOUT_MULTIPLIER = 2.5;
const DICE_MISS_MULTIPLIER = 0.5;
const DICE_EMOJI = "🎲";

const formatMoney = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;

const diceHandler = async (ctx) => {
  const userId = ctx.from.id;
  const args = (ctx.message?.text || "").trim().split(/\s+/);
  const chosenNumber = Number(args[1]);
  const betAmount = Math.floor(Number(args[2]) * 100);

  if (!Number.isInteger(chosenNumber) || chosenNumber < 1 || chosenNumber > 6 || !Number.isFinite(betAmount) || betAmount <= 0) {
    return ctx.reply("အသုံးပြုပုံ: /dice <1-6> <ထိုးကြေး>\nဥပမာ: /dice 5 100");
  }

  let ownerSettings;
  try {
    ownerSettings = await getOwnerSettings();
  } catch (error) {
    logger.error(`Dice settings error: ${error.message}`);
    ownerSettings = { minBet: 500, maxBet: 10000, pauseSlot: false };
  }

  if (ownerSettings.pauseSlot && !isOwner(ctx)) {
    return ctx.reply("🛠 Dice game is temporarily paused by owner.");
  }
  if (betAmount < ownerSettings.minBet) {
    return ctx.reply(`🔴 အနည်းဆုံး ${formatMoney(ownerSettings.minBet)} လောင်းရပါမည်။`);
  }
  if (betAmount > ownerSettings.maxBet) {
    return ctx.reply(`🔴 အများဆုံး ${formatMoney(ownerSettings.maxBet)} ထိသာ လောင်းနိုင်ပါသည်။`);
  }

  let charged = false;
  let diceMessage = null;
  try {
    const remainingBalance = await debit(userId, betAmount);
    if (remainingBalance === null) return ctx.reply(getString("NO_BALANCE"));
    charged = true;

    diceMessage = await ctx.telegram.sendDice(ctx.chat.id, {
      emoji: DICE_EMOJI,
      reply_to_message_id: ctx.message.message_id,
    });

    const result = Number(diceMessage.dice?.value);
    if (!Number.isInteger(result) || result < 1 || result > 6) {
      throw new Error(`Invalid Telegram dice result: ${result}`);
    }

    const won = result === chosenNumber;
    const multiplier = won ? DICE_PAYOUT_MULTIPLIER : DICE_MISS_MULTIPLIER;
    const payout = Math.floor(betAmount * multiplier);
    if (payout > 0) await credit(userId, payout);

    const status = won ? "Win" : "Lose";
    return ctx.telegram.sendMessage(ctx.chat.id,
      `🎲 DICE RESULT\n\n` +
      `Target - ${chosenNumber}\n` +
      `Bet - ${formatMoney(betAmount)}\n\n` +
      `Result - ${result}\n` +
      `Payout - ${formatMoney(payout)} [${status} ${multiplier}x]`,
      { reply_to_message_id: diceMessage.message_id },
    );
  } catch (error) {
    logger.error(`Dice handler error: ${error.stack || error.message}`);
    if (charged) await credit(userId, betAmount).catch((refundError) =>
      logger.error(`Dice refund error: ${refundError.message}`)
    );
    if (diceMessage) {
      return ctx.telegram.sendMessage(ctx.chat.id, getString("DATABASE_LOCK"), {
        reply_to_message_id: diceMessage.message_id,
      }).catch(() => {});
    }
    return ctx.reply(getString("DATABASE_LOCK")).catch(() => {});
  }
};

const composer = new Composer();
composer.command("dice", diceHandler);

module.exports = composer;

module.exports.DICE_PAYOUT_MULTIPLIER = DICE_PAYOUT_MULTIPLIER;
module.exports.DICE_MISS_MULTIPLIER = DICE_MISS_MULTIPLIER;
module.exports.diceHandler = diceHandler;
