const Product = require("../database/entity/product.entity");

const isUserHaveThisProduct = async ({ id, productName }) => {
  const product = await Product.findOne({ user: id, product: productName });
  return !!product;
};

const getUserProduct = async ({ id }) => {
  return await Product.find({ user: id });
};

module.exports = { isUserHaveThisProduct, getUserProduct };
