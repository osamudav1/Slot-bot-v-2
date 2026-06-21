const { Composer } = require("telegraf");
const products = require("../products");

module.exports = Composer.command("market", async (ctx) => {
  let productsAsText = "\n";
  products.forEach((el, index) => {
    productsAsText = productsAsText + `${index + 1} - ${el.name} > ${el.price}${el.currency}\n`;
  });

  await ctx.replyWithMarkdown(`🏬 Market ${productsAsText}`);
});
