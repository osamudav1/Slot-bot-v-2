const { Composer } = require("telegraf");
const products = require("../products");
const { getCommandName } = require("../lang/index");

module.exports = Composer.command(getCommandName("market"), async (ctx) => {
  let productsAsText = "\n";
  products.forEach((el, index) => {
    productsAsText = productsAsText + `${index + 1} - ${el.name} > ${el.price}${el.currency}\n`;
  });

  await ctx.replyWithMarkdown(`🏬 Market ${productsAsText}`);
});
