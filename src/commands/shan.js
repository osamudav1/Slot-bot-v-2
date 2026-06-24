const { Composer, Markup } = require("telegraf");
const { increaseBankAmount, decreaseBankAmount } = require("../modules/bank.module");
const { getString, getCommandName } = require("../lang/index");
const User = require("../database/entity/user.entitiy");
const logger = require("../logger");

const activeGames = new Map();

const SUITS = ["♠️", "♥️", "♣️", "♦️"];
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

const createDeck = () => {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value });
    }
  }
  return deck.sort(() => Math.random() - 0.5);
};

const getCardValue = (card) => {
  if (["J", "Q", "K"].includes(card.value)) return 10;
  if (card.value === "A") return 1;
  return parseInt(card.value);
};

const calculatePoints = (cards) => {
  const total = cards.reduce((sum, card) => sum + getCardValue(card), 0);
  return total % 10;
};

const formatHand = (cards) => {
  return cards.map(c => `${c.value}${c.suit}`).join(" ");
};

const shanHandler = async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const gameKey = `${chatId}:${userId}`;

  try {
    if (activeGames.has(gameKey)) {
      return ctx.reply("ဂိမ်းဆော့နေဆဲဖြစ်ပါသည်။ ခဏစောင့်ပေးပါ။").catch(() => {});
    }

    const text = ctx.message.text || "";
    const args = text.split(" ");
    const betAmount = args[1] ? parseInt(args[1]) : 1000;

    if (isNaN(betAmount) || betAmount <= 0) {
      return ctx.reply("အသုံးပြုပုံ: /shan <ပမာဏ>");
    }

    if (betAmount < 500) {
      return ctx.reply("🔴 အနည်းဆုံး 500 MMK လောင်းရပါမည်။");
    }
    if (betAmount > 200000) {
      return ctx.reply("🔴 အများဆုံး 200,000 MMK ထိသာ လောင်းနိုင်ပါသည်။");
    }

    const user = await User.findOneAndUpdate(
      { id: userId, balance: { $gte: betAmount } },
      { $inc: { balance: -betAmount } },
      { new: true }
    );

    if (!user) {
      return ctx.reply(getString("NO_BALANCE"));
    }

    const deck = createDeck();
    const userHand = [deck.pop(), deck.pop()];
    const botHand = [deck.pop(), deck.pop()];

    const userPoints = calculatePoints(userHand);
    const botPoints = calculatePoints(botHand);

    activeGames.set(gameKey, {
      userId,
      chatId,
      betAmount,
      userHand,
      botHand,
      deck,
      status: "playing"
    });

    const gameMsg = `🃏 *SHAN KO MEE* 🃏\n` +
      `━━━━━━━━━━━━━\n` +
      `👤 User: ${formatHand(userHand)} (${userPoints} မှတ်)\n` +
      `🤖 Bot: 🎴 🎴\n` +
      `━━━━━━━━━━━━━\n` +
      `💵 လောင်းကြေး: ${betAmount} MMK\n\n` +
      `ကဒ်ထပ်ဆွဲမလား သို့မဟုတ် ရပ်မလား?`;

    await ctx.replyWithMarkdown(gameMsg, Markup.inlineKeyboard([
      [
        Markup.button.callback("ကဒ်ဆွဲမယ် ➕", `shan_draw_${userId}`),
        Markup.button.callback("တော်ပြီ ✋", `shan_stand_${userId}`)
      ]
    ]));

    // Auto-reveal if bot has high points (Shan 8 or 9)
    if (botPoints >= 8) {
        setTimeout(() => {
          const currentGame = activeGames.get(gameKey);
          if (currentGame && currentGame.status === "playing") {
            resolveGame(ctx, gameKey, true);
          }
        }, 1500);
    }

    // Set a timeout to auto-resolve game if user doesn't respond in 60 seconds
    setTimeout(() => {
      const currentGame = activeGames.get(gameKey);
      if (currentGame && currentGame.status === "playing") {
        resolveGame(ctx, gameKey, false, true); // true for timeout
      }
    }, 60000);

  } catch (err) {
    logger.error("Shan handler error: " + err.stack);
    activeGames.delete(gameKey);
    return ctx.reply(getString("DATABASE_LOCK")).catch(() => {});
  }
};

const resolveGame = async (ctx, gameKey, botInstantReveal = false, isTimeout = false) => {
  const game = activeGames.get(gameKey);
  if (!game || game.status !== "playing") return;

  game.status = "resolved";
  activeGames.delete(gameKey);

  // Bot AI: Draw if points <= 5 and not a Shan 8/9
  let botInitialPoints = calculatePoints(game.botHand);
  let botDrew = false;
  if (botInitialPoints <= 5) {
    game.botHand.push(game.deck.pop());
    botDrew = true;
  }

  const userPoints = calculatePoints(game.userHand);
  const botPoints = calculatePoints(game.botHand);

  let resultText = "";
  let winAmount = 0;

  if (botInstantReveal) {
    resultText = `⚠️ Bot မှာ ${botInitialPoints} မှတ် (ရှမ်း) ရနေသဖြင့် တန်းဖွင့်လိုက်ပါပြီ!`;
  } else if (isTimeout) {
    resultText = `⏰ အချိန်ကျော်သွားသဖြင့် အလိုအလျောက် ဖွင့်လိုက်ပါပြီ။`;
  }

  if (botDrew && !botInstantReveal) {
    resultText += `\n🤖 Bot က ကဒ်တစ်ကဒ် ထပ်ဆွဲထားပါသည်။`;
  }

  if (userPoints > botPoints) {
    winAmount = game.betAmount * 2;
    resultText += `\n\n🎉 သင်နိုင်ပါသည်! +${winAmount} MMK`;
    await User.findOneAndUpdate({ id: game.userId }, { $inc: { balance: winAmount } });
    await decreaseBankAmount({ ctx, decreaseAmont: winAmount - game.betAmount }).catch(() => {});
  } else if (userPoints < botPoints) {
    resultText += `\n\n💸 Bot နိုင်ပါသည်! -${game.betAmount} MMK`;
    await increaseBankAmount({ ctx, increaseAmount: game.betAmount }).catch(() => {});
  } else {
    winAmount = game.betAmount;
    resultText += `\n\n🤝 သရေကျပါသည်။ လောင်းကြေးပြန်ရပါမည်။`;
    await User.findOneAndUpdate({ id: game.userId }, { $inc: { balance: winAmount } });
  }

  const finalMsg = `🃏 *SHAN KO MEE - ရလဒ်* 🃏\n` +
    `━━━━━━━━━━━━━\n` +
    `👤 User: ${formatHand(game.userHand)} (${userPoints} မှတ်)\n` +
    `🤖 Bot: ${formatHand(game.botHand)} (${botPoints} မှတ်)\n` +
    `━━━━━━━━━━━━━\n` +
    resultText;

  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(finalMsg, { parse_mode: "Markdown" }).catch(() => {});
    } else {
      await ctx.telegram.sendMessage(game.chatId, finalMsg, { parse_mode: "Markdown" }).catch(() => {});
    }
  } catch (err) {
    logger.error("Resolve message error: " + err.message);
  }
};

const composer = new Composer();
composer.command(getCommandName("shan") || "shan", shanHandler);
composer.hears(/^\.shan(\s+.*)?$/, shanHandler);

composer.action(/^shan_draw_(\d+)$/, async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCbQuery("ဒါက သင့်အတွက် မဟုတ်ပါ!");

  const gameKey = `${ctx.chat.id}:${userId}`;
  const game = activeGames.get(gameKey);
  if (!game) return ctx.answerCbQuery("ဂိမ်းသက်တမ်းကုန်သွားပါပြီ။");

  if (game.userHand.length >= 3) return ctx.answerCbQuery("ကဒ် ၃ ကဒ်ထက် ပိုဆွဲ၍မရပါ!");

  game.userHand.push(game.deck.pop());
  
  // Auto-resolve after 3rd card
  await resolveGame(ctx, gameKey);
  
  ctx.answerCbQuery();
});

composer.action(/^shan_stand_(\d+)$/, async (ctx) => {
  const userId = parseInt(ctx.match[1]);
  if (ctx.from.id !== userId) return ctx.answerCbQuery("ဒါက သင့်အတွက် မဟုတ်ပါ!");

  const gameKey = `${ctx.chat.id}:${userId}`;
  const game = activeGames.get(gameKey);
  if (!game) return ctx.answerCbQuery("ဂိမ်းသက်တမ်းကုန်သွားပါပြီ။");

  await resolveGame(ctx, gameKey);
  ctx.answerCbQuery();
});

module.exports = composer;
