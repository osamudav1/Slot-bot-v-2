const { Composer, Markup } = require("telegraf");

const composer = new Composer();

composer.command("help", async (ctx) => {
  const helpText = `📜 CARD PURCHASE RULES

🟢 Common – Medium Cards

* ကဒ်များကို တစ်ကဒ်ချင်း ဝယ်ယူ၍မရပါ။
* အနည်းဆုံး 5 cards စုပေါင်းပြီး တစ်ခါတည်း ဝယ်ယူရမည်။

⸻

🔵 Legend – Mythical Cards

* ကဒ်များကို တစ်ကဒ်ချင်း ဝယ်ယူ၍မရပါ။
* အနည်းဆုံး 3 cards စုပေါင်းပြီး တစ်ခါတည်း ဝယ်ယူရမည်။

⸻

🟣 Divine – Supreme Cards

* ကဒ်များကို တစ်ကဒ်ချင်းစီ ဝယ်ယူနိုင်ပါသည်။

ဝယ်ယူမည့်ကဒ်ID ကိုအရင်ရှာဖွေပီးမှဝယ်ယူပေးပါ

⸻

📌 NOTE

* ကဒ်စျေးနှုန်းများကို /market တွင် ကြည့်ရှုနိုင်ပါသည်။ 

/daily ကိုအသုံးပြ၍ နေ့စဉ် 500MMk မှ 6000MMk အတွင်း redeem စနစ်ဖြင့်ရယူလိုက်ပါ`;

  return ctx.reply(helpText, Markup.inlineKeyboard([
    [Markup.button.url("Official Group", "https://t.me/pyaesone2d2")]
  ]));
});

module.exports = composer;
