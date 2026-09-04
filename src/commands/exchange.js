const { Composer } = require("telegraf");

const composer = new Composer();

composer.command("exchange", async (ctx) => {
  return ctx.reply(
    "ℹ️ Waifu wallet မသုံးတော့ပါ။\n" +
    "🎰 Slot wallet balance ကို /wallet သို့မဟုတ် /bal ဖြင့် စစ်နိုင်ပါသည်။\n" +
    "Owner သည် user message ကို reply လုပ်ပြီး +amount / -amount ဖြင့် Slot wallet ပြင်နိုင်ပါသည်.",
  );
});

module.exports = composer;
