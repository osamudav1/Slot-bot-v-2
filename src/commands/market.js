const { Composer } = require("telegraf");
const products = require("../products");
const { getCommandName } = require("../lang/index");

const marketHandler = async (ctx) => {
  let productsAsText = "\n";
  products.forEach((el, index) => {
    productsAsText = productsAsText + `${index + 1} - ${el.name} > ${el.price}${el.currency}\n`;
  });

  productsAsText += `\n💳 ပီးထိုးကြေး > 25,000MMK`;

  await ctx.replyWithMarkdown(`🏬 Market ${productsAsText}`);
};

const composer = new Composer();
composer.command("gmarket", marketHandler);
composer.command("market", marketHandler); // Keep old one just in case

module.exports = composer;
