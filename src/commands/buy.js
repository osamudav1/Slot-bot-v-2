const { getString, getCommandName } = require("../lang/index");
const { Composer } = require("telegraf");
const { isUserHaveThisProduct } = require("../modules/product.module");
const { increaseBankAmount } = require("../modules/bank.module");
const { getUser, setUser } = require("../modules/user.module");
const Product = require("../database/entity/product.entity.js");
const products = require("../products.js");
const logger = require("../logger");

module.exports = Composer.command(getCommandName("buy"), async (ctx) => {
  try {
    const option = ctx?.update?.message?.text.split(" ")[1];
    const user = await getUser({ id: ctx?.update?.message?.from?.id });
    if (!user) return ctx.reply(getString("DATABASE_LOCK"));

    if (!option) return ctx.reply(getString("INVALID_PRODUCT_ID"));
    let selectedProduct;
    for (let [index, product] of products.entries()) {
      if (index + 1 == option) selectedProduct = product;
    }

    if (!selectedProduct) return ctx.reply(getString("PRODUCT_NOT_AVAILABLE"));

    if (await isUserHaveThisProduct({ id: ctx?.update?.message?.from?.id, productName: selectedProduct.code })) return ctx.reply(getString("ALREADY_BOUGHT"));
    const productPrice = parseInt(selectedProduct.price.replace(/,/g, ''));
    if (user?.coins < productPrice || !user?.coins) return ctx.reply(getString("NO_BALANCE"));

    await increaseBankAmount({ ctx, increaseAmount: productPrice });

    user.coins = user?.coins - productPrice;

    const productItem = new Product({
      product: selectedProduct.code,
      user: user.id,
    });

    await productItem.save();
    await setUser({ user });
    return ctx.reply(getString("BUY_PRODUCT_SUCCESS"));
  } catch (err) {
    logger.error(err);
    return ctx.reply(getString("DATABASE_LOCK"));
  }
});
