const { Composer, Markup } = require("telegraf");
const { increaseBankAmount, decreaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const { debit, credit } = require("../modules/slot-wallet.module");
const logger = require("../logger");
const { getPoolBalance, addToPool, subtractFromPool } = require("../modules/pool.module");
const { getOwnerSettings } = require("../modules/owner-settings.module");
const { isOwner } = require("../modules/owner.module");

const activeGames = new Map();
const lastShanTime = new Map();
const shanLossStreak = new Map();
const GAME_TIMEOUT = 60000;
const VERY_LOW_POOL_THRESHOLD = 100000;
const VERY_LOW_POOL_WIN = 5;
const VERY_LOW_POOL_TIE = 35;
const LOW_POOL_THRESHOLD = 200000;
const LOW_POOL_WIN = 15;
const LOW_POOL_TIE = 30;
const LOW_POOL_LOSE = 55;
const LOSS_BOOST_AFTER = 4;
const LOSS_BOOST = 5;

const SUITS = ["♠️", "♥️", "♣️", "♦️"];
const SUIT_STRENGTH = { "♣️": 1, "♥️": 2, "♦️": 3, "♠️": 4 };
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RANK_VALUE = { A: 14, K: 13, Q: 12, J: 11 };

const createDeck = () => {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) deck.push({ suit, value });
  }

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const getCardValue = (card) => {
  if (["J", "Q", "K"].includes(card.value)) return 10;
  if (card.value === "A") return 1;
  return Number(card.value);
};

const getRankValue = (card) => RANK_VALUE[card.value] || Number(card.value);

const calculatePoints = (cards) => cards.reduce((sum, card) => sum + getCardValue(card), 0) % 10;

const getHandInfo = (cards) => ({
  // Shan now uses points only. Pair, three-of-a-kind, rank, and suit do not
  // change the winner; the final point number is the sole comparison value.
  category: 1,
  categoryName: "Point",
  points: calculatePoints(cards),
});

const compareHands = (left, right) => {
  if (left.points !== right.points) return left.points > right.points ? 1 : -1;
  return 0;
};

const formatHand = (cards) => cards.map((card) => `${card.value}${card.suit}`).join(" ");
const money = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const getLowPoolTarget = (userId, poolBalance) => {
  if (Number(poolBalance) >= LOW_POOL_THRESHOLD) return null;
  const streak = shanLossStreak.get(String(userId)) || 0;
  const isVeryLowPool = Number(poolBalance) < VERY_LOW_POOL_THRESHOLD;
  const baseWinRate = isVeryLowPool ? VERY_LOW_POOL_WIN : LOW_POOL_WIN;
  const tieRate = isVeryLowPool ? VERY_LOW_POOL_TIE : LOW_POOL_TIE;
  const winRate = baseWinRate + (streak >= LOSS_BOOST_AFTER ? LOSS_BOOST : 0);
  const roll = Math.random() * 100;
  if (roll < winRate) return "PLAYER";
  if (roll < winRate + tieRate) return "TIE";
  return "BANKER";
};

const recordShanResult = (userId, result) => {
  const key = String(userId);
  const streak = shanLossStreak.get(key) || 0;
  if (result === "PLAYER") {
    shanLossStreak.delete(key);
  } else if (result === "BANKER") {
    shanLossStreak.set(key, streak + 1);
  }
};

const findHandForTarget = (playerHand, deck, target) => {
  if (!target) return null;
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    const candidates = [...deck].sort(() => Math.random() - 0.5);
    const bankerHand = [candidates[0], candidates[1]];
    if (shouldBankerDraw(bankerHand)) bankerHand.push(candidates[2]);
    const comparison = compareHands(getHandInfo(playerHand), getHandInfo(bankerHand));
    const result = comparison > 0 ? "PLAYER" : comparison < 0 ? "BANKER" : "TIE";
    if (result === target) return bankerHand;
  }
  return null;
};

const shouldBankerDraw = (hand) => {
  const info = getHandInfo(hand);
  // Banker draws exactly one card when its point is 0–4; it stands on 5–9.
  return info.points >= 0 && info.points <= 4;
};

const settleGame = async (ctx, gameKey, isTimeout = false) => {
  const game = activeGames.get(gameKey);
  if (!game || game.status !== "playing") return;

  // Set the state synchronously before any await so callback/timeout races cannot pay twice.
  game.status = "resolved";
  activeGames.delete(gameKey);

  try {
    if (shouldBankerDraw(game.bankerHand)) game.bankerHand.push(game.deck.pop());

    if (game.targetResult) {
      const controlledHand = findHandForTarget(game.playerHand, game.deck, game.targetResult);
      if (controlledHand) game.bankerHand = controlledHand;
    }

    const playerInfo = getHandInfo(game.playerHand);
    const bankerInfo = getHandInfo(game.bankerHand);
    const comparison = compareHands(playerInfo, bankerInfo);
    // The card result is authoritative: the higher final point wins.
    // Pool balance must never rewrite Player Win into Banker Win.
    const result = comparison > 0 ? "PLAYER" : comparison < 0 ? "BANKER" : "TIE";
    recordShanResult(game.userId, result);

    let resultText;
    if (result === "PLAYER") {
      const payout = game.betAmount * 2;
      const profit = game.betAmount;
      await credit(game.userId, payout);
      await subtractFromPool(profit);
      await decreaseBankAmount({ ctx, decreaseAmont: profit }).catch((error) => logger.error(`Bank decrease error: ${error.message}`));
      resultText = `👤 User Win +${money(payout)}`;
    } else if (result === "BANKER") {
      await addToPool(game.betAmount);
      await increaseBankAmount({ ctx, increaseAmount: game.betAmount }).catch((error) => logger.error(`Bank increase error: ${error.message}`));
      resultText = `🏦 Banker Win\nLose - ${money(game.betAmount)}`;
    } else {
      await credit(game.userId, game.betAmount);
      resultText = `⚖️ Tie\nReturn - ${money(game.betAmount)}`;
    }

    const timeoutText = isTimeout ? "\n⏱️ အချိန်ကုန်သဖြင့် အလိုအလျောက်ဆုံးဖြတ်ထားသည်။" : "";
    const finalMsg = `🃏 *SHAN KO MEE - ရလဒ်* 🃏\n` +
      `━━━━━━━━━━━━━\n` +
      `👤 Player: ${formatHand(game.playerHand)} (${playerInfo.categoryName}, ${playerInfo.points} မှတ်)\n` +
      `🏦 Banker: ${formatHand(game.bankerHand)} (${bankerInfo.categoryName}, ${bankerInfo.points} မှတ်)\n` +
      `━━━━━━━━━━━━━\n` +
      `${resultText}${timeoutText}`;

    await ctx.telegram.editMessageText(game.chatId, game.messageId, null, finalMsg, { parse_mode: "Markdown" }).catch(async (error) => {
      logger.error(`Edit Shan result error: ${error.message}`);
      await ctx.telegram.sendMessage(game.chatId, finalMsg, { parse_mode: "Markdown" }).catch(() => {});
    });
  } catch (error) {
    logger.error(`Shan settlement error: ${error.stack || error.message}`);
    await credit(game.userId, game.betAmount).catch(() => {});
    await ctx.telegram.sendMessage(game.chatId, "ဂိမ်း settlement အမှားဖြစ်သဖြင့် လောင်းကြေးကို ပြန်အမ်းထားပါသည်။").catch(() => {});
  }
};

const shanHandler = async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const gameKey = `${chatId}:${userId}`;
  let charged = false;

  try {
    if (activeGames.has(gameKey)) return ctx.reply("ဂိမ်းဆော့နေဆဲဖြစ်ပါသည်။ ခဏစောင့်ပေးပါ။").catch(() => {});

    const ownerId = process.env.OWNER_ID;
    let ownerSettings;
    try {
      ownerSettings = await getOwnerSettings();
    } catch (settingsError) {
      logger.error(`Shan settings error: ${settingsError.message}`);
      ownerSettings = { minBet: 500, maxBet: 25000, cooldown: 8000, pauseShan: false };
    }
    if (ownerSettings.pauseShan && !isOwner(ctx)) {
      return ctx.reply("🛠 Shan game is temporarily paused by owner.").catch(() => {});
    }

    const now = Date.now();
    if (!isOwner(ctx) && lastShanTime.has(userId)) {
      const timeLeft = Math.ceil((lastShanTime.get(userId) + ownerSettings.cooldown - now) / 1000);
      if (timeLeft > 0) return ctx.reply(`⏳ Please wait ${timeLeft} seconds before playing again!`).catch(() => {});
    }

    const args = (ctx.message.text || "").trim().split(/\s+/);
    const betAmount = args[1] ? Math.floor(Number(args[1]) * 100) : 0;
    if (!Number.isFinite(betAmount) || betAmount <= 0) return ctx.reply("အသုံးပြုပုံ: /shan <ပမာဏ_ဒေါ်လာ>\nဥပမာ: /shan 20");
    if (betAmount < ownerSettings.minBet) return ctx.reply(`🔴 အနည်းဆုံး $${(ownerSettings.minBet / 100).toFixed(2)} လောင်းရပါမည်။`);
    if (betAmount > ownerSettings.maxBet) return ctx.reply(`🔴 အများဆုံး $${(ownerSettings.maxBet / 100).toFixed(2)} ထိသာ လောင်းနိုင်ပါသည်။`);

    const remainingBalance = await debit(userId, betAmount);
    if (remainingBalance === null) return ctx.reply(getString("NO_BALANCE"));
    charged = true;

    const deck = createDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const bankerHand = [deck.pop(), deck.pop()];
    const poolBalance = await getPoolBalance();
    const targetResult = getLowPoolTarget(userId, poolBalance);
    const playerInfo = getHandInfo(playerHand);

    const gameMsg = `🃏 *SHAN KO MEE* 🃏\n` +
      `━━━━━━━━━━━━━\n` +
      `👤 Player: ${formatHand(playerHand)} (${playerInfo.categoryName}, ${playerInfo.points} မှတ်)\n` +
      `🏦 Banker: 🎴 🎴\n` +
      `━━━━━━━━━━━━━\n` +
      `💵 လောင်းကြေး: ${money(betAmount)}\n\n` +
      `ကတ်ထပ်ဆွဲမလား သို့မဟုတ် ရပ်မလား?`;

    const sentMsg = await ctx.replyWithMarkdown(gameMsg, {
      reply_to_message_id: ctx.message.message_id,
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("ကတ်ထပ်ဆွဲမယ် ➕", `shan_draw_${userId}`),
          Markup.button.callback("တော်ပြီ ✋", `shan_stand_${userId}`)
        ]
      ])
    });

    activeGames.set(gameKey, {
      userId,
      chatId,
      messageId: sentMsg.message_id,
      betAmount,
      playerHand,
      bankerHand,
      deck,
      targetResult,
      status: "playing"
    });
    lastShanTime.set(userId, Date.now());

    setTimeout(() => {
      const currentGame = activeGames.get(gameKey);
      if (currentGame && currentGame.status === "playing") settleGame(ctx, gameKey, true);
    }, GAME_TIMEOUT);
  } catch (error) {
    logger.error(`Shan handler error: ${error.stack || error.message}`);
    activeGames.delete(gameKey);
    if (charged) await credit(userId, betAmountFromContext(ctx)).catch(() => {});
    return ctx.reply(getString("DATABASE_LOCK")).catch(() => {});
  }
};

const betAmountFromContext = (ctx) => {
  const args = (ctx.message?.text || "").trim().split(/\s+/);
  return Math.floor(Number(args[1] || 0) * 100);
};

const composer = new Composer();
composer.command(getCommandName("shan") || "shan", shanHandler);
composer.hears(/^\.shan(\s+.*)?$/, shanHandler);

composer.action(/^shan_draw_(\d+)$/, async (ctx) => {
  const userId = parseInt(ctx.match[1], 10);
  if (ctx.from.id !== userId) return ctx.answerCbQuery("ဒါက သင့်အတွက် မဟုတ်ပါ!");

  const gameKey = `${ctx.chat.id}:${userId}`;
  const game = activeGames.get(gameKey);
  if (!game || game.status !== "playing") return ctx.answerCbQuery("ဂိမ်းသက်တမ်းကုန်သွားပါပြီ။");
  if (game.playerHand.length >= 3) return ctx.answerCbQuery("ကတ် ၃ ကတ်ထက် ပိုဆွဲ၍မရပါ!");

  game.playerHand.push(game.deck.pop());
  // Acknowledge Telegram immediately; settlement may require several database writes.
  await ctx.answerCbQuery();
  settleGame(ctx, gameKey).catch((error) =>
    logger.error(`Async Shan draw settlement error: ${error.message}`)
  );
  return;
});

composer.action(/^shan_stand_(\d+)$/, async (ctx) => {
  const userId = parseInt(ctx.match[1], 10);
  if (ctx.from.id !== userId) return ctx.answerCbQuery("ဒါက သင့်အတွက် မဟုတ်ပါ!");

  const gameKey = `${ctx.chat.id}:${userId}`;
  const game = activeGames.get(gameKey);
  if (!game || game.status !== "playing") return ctx.answerCbQuery("ဂိမ်းသက်တမ်းကုန်သွားပါပြီ။");

  // Acknowledge Telegram immediately; settlement may require several database writes.
  await ctx.answerCbQuery();
  settleGame(ctx, gameKey).catch((error) =>
    logger.error(`Async Shan stand settlement error: ${error.message}`)
  );
  return;
});

module.exports = composer;
