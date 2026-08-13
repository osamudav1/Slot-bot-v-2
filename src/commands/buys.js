const { Composer } = require("telegraf");

const composer = new Composer();

composer.command("buys", async (ctx) => {
  if (ctx.chat?.type !== "private") {
    return ctx.reply("🔒 GRAM ဝယ်ယူမှုကို private chat ထဲမှာပဲ လုပ်ပေးပါ။");
  }
  try {
    if (ctx.scene?.current) await ctx.scene.leave();
    return await ctx.scene.enter("gram-buy");
  } catch (error) {
    console.error("/buys scene error:", error);
    return ctx.reply("❌ Top Up screen ဖွင့်မရပါ။ Bot ကို restart လုပ်ပြီး ထပ်ကြိုးစားပါ။");
  }
});

module.exports = composer;
