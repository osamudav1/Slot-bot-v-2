const { Composer, Markup } = require("telegraf");
const { increaseBankAmount, decreaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");
const { getPoolBalance, addToPool, subtractFromPool } = require("../modules/pool.module");

const activeGames = new Map();
const lastShanTime = new Map();
const COOLDOWN_TIME = 8000;
const GAME_TIMEOUT = 60000;
const MIN_POOL_RESERVE = 2000;

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

const getHandInfo = (cards) => {
  const counts = new Map();
  for (const card of cards) counts.set(card.value, (counts.get(card.value) || 0) + 1);

  const groups = [...counts.entries()]
    .map(([value, count]) => ({ value, count, rank: RANK_VALUE[value] || Number(value) }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const sortedCards = [...cards].sort((a, b) => getRankValue(b) - getRankValue(a) || SUIT_STRENGTH[b.suit] - SUIT_STRENGTH[a.suit]);
  const category = groups[0]?.count === 3 ? 3 : groups[0]?.count === 2 ? 2 : 1;
  const categoryName = category === 3 ? "Three-of-a-kind" : category === 2 ? "Pair" : "Point";

  return {
    category,
    categoryName,
    points: calculatePoints(cards),
    groups,
    highestCard: sortedCards[0],
    tieBreakers: sortedCards.map((card) => getRankValue(card)),
  };
};

const compareHands = (left, right) => {
  if (left.category !== right.category) return left.category > right.category ? 1 : -1;

  if (left.category === 3 || left.category === 2) {
    const leftGroup = left.groups[0];
    const rightGroup = right.groups[0];
    if (leftGroup.rank !== rightGroup.rank) return leftGroup.rank > rightGroup.rank ? 1 : -1;
  }

  if (left.points !== right.points) return left.points > right.points ? 1 : -1;

  for (let i = 0; i < Math.max(left.tieBreakers.length, right.tieBreakers.length); i += 1) {
    if ((left.tieBreakers[i] || 0) !== (right.tieBreakers[i] || 0)) {
      return (left.tieBreakers[i] || 0) > (right.tieBreakers[i] || 0) ? 1 : -1;
    }
  }

  const leftSuit = SUIT_STRENGTH[left.highestCard?.suit] || 0;
  const rightSuit = SUIT_STRENGTH[right.highestCard?.suit] || 0;
  if (leftSuit !== rightSuit) return leftSuit > rightSuit ? 1 : -1;
  return 0;
};

const formatHand = (cards) => cards.map((card) => `${card.value}${card.suit}`).join(" ");
const money = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shouldBankerDraw = (hand) => {
  const info = getHandInfo(hand);
  return info.category === 1 && info.points >= 3 && info.points <= 5;
};

const settleGame = async (ctx, gameKey, isTimeout = false) => {
  const game = activeGames.get(gameKey);
  if (!game || game.status !== "playing") return;

  // Set the state synchronously before any await so callback/timeout races cannot pay twice.
  game.status = "resolved";
  activeGames.delete(gameKey);

  try {
    if (shouldBankerDraw(game.bankerHand)) game.bankerHand.push(game.deck.pop());

    const playerInfo = getHandInfo(game.playerHand);
    const bankerInfo = getHandInfo(game.bankerHand);
    const comparison = compareHands(playerInfo, bankerInfo);
    const result = comparison > 0 ? "PLAYER" : comparison < 0 ? "BANKER" : "TIE";
    const winnerInfo = result === "PLAYER" ? playerInfo : bankerInfo;

    let resultText;
    if (result === "PLAYER") {
      const payout = game.betAmount * 2;
      const profit = game.betAmount;
      await User.findOneAndUpdate({ id: Number(game.userId) }, { $inc: { coins: payout } });
      await subtractFromPool(profit);
      await decreaseBankAmount({ ctx, decreaseAmont: profit }).catch((error) => logger.error(`Bank decrease error: ${error.message}`));
      resultText = `👤 Player အနိုင်\n+${money(profit)} အမြတ် (စုစုပေါင်း ${money(payout)} ပြန်ရ)\nအမျိုးအစား: ${winnerInfo.categoryName}`;
    } else if (result === "BANKER") {
      await addToPool(game.betAmount);
      await increaseBankAmount({ ctx, increaseAmount: game.betAmount }).catch((error) => logger.error(`Bank increase error: ${error.message}`));
      resultText = `🏦 Banker အနိုင်\n-${money(game.betAmount)}\nအမျိုးအစား: ${winnerInfo.categoryName}`;
    } else {
      await User.findOneAndUpdate({ id: Number(game.userId) }, { $inc: { coins: game.betAmount } });
      resultText = `⚖️ Tie ဖြစ်ပါသည်\n${money(game.betAmount)} ပြန်အမ်းပါသည်`;
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
    await User.findOneAndUpdate({ id: Number(game.userId) }, { $inc: { coins: game.betAmount } }).catch(() => {});
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
    const now = Date.now();
    if (ownerId !== userId.toString() && lastShanTime.has(userId)) {
      const timeLeft = Math.ceil((lastShanTime.get(userId) + COOLDOWN_TIME - now) / 1000);
      if (timeLeft > 0) return ctx.reply(`⏳ Please wait ${timeLeft} seconds before playing again!`).catch(() => {});
    }

    const args = (ctx.message.text || "").trim().split(/\s+/);
    const betAmount = args[1] ? Math.floor(Number(args[1]) * 100) : 100;
    if (!Number.isFinite(betAmount) || betAmount <= 0) return ctx.reply("အသုံးပြုပုံ: /shan <ပမာဏ_ဒေါ်လာ>\nဥပမာ: /shan 20");
    if (betAmount < 2000) return ctx.reply("🔴 အနည်းဆုံး $20 လောင်းရပါမည်။");
    if (betAmount > 50000) return ctx.reply("🔴 အများဆုံး $500 ထိသာ လောင်းနိုင်ပါသည်။");

    const poolBalance = await getPoolBalance();
    if (poolBalance < MIN_POOL_RESERVE + betAmount) {
      return ctx.reply(`🔒 လက်ရှိ စုဗူး reserve မလုံလောက်သေးပါ။ အနည်းဆုံး ${money(MIN_POOL_RESERVE)} reserve ထားပြီး payout လုံလောက်မှသာ ကစားနိုင်ပါသည်။`);
    }

    const user = await User.findOneAndUpdate(
      { id: Number(userId), coins: { $gte: betAmount } },
      { $inc: { coins: -betAmount } },
      { new: true }
    );
    if (!user) return ctx.reply(getString("NO_BALANCE"));
    charged = true;

    const deck = createDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const bankerHand = [deck.pop(), deck.pop()];
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
    if (charged) await User.findOneAndUpdate({ id: Number(userId) }, { $inc: { coins: betAmountFromContext(ctx) } }).catch(() => {});
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
  await settleGame(ctx, gameKey);
  return ctx.answerCbQuery();
});

composer.action(/^shan_stand_(\d+)$/, async (ctx) => {
  const userId = parseInt(ctx.match[1], 10);
  if (ctx.from.id !== userId) return ctx.answerCbQuery("ဒါက သင့်အတွက် မဟုတ်ပါ!");

  const gameKey = `${ctx.chat.id}:${userId}`;
  const game = activeGames.get(gameKey);
  if (!game || game.status !== "playing") return ctx.answerCbQuery("ဂိမ်းသက်တမ်းကုန်သွားပါပြီ။");

  await settleGame(ctx, gameKey);
  return ctx.answerCbQuery();
});

module.exports = composer;
