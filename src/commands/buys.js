const { Composer } = require("telegraf");

const composer = new Composer();

composer.command("buys", async (ctx) => {
  if (ctx.chat?.type !== "private") {
    return ctx.reply("🔒 GRAM ဝယ်ယူမှုကို private chat ထဲမှာပဲ လုပ်ပေးပါ။");
  }
  return ctx.scene.enter("gram-buy");
});

module.exports = composer;
