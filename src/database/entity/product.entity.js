const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  product: {
    type: String,
    required: true,
  },
  user: {
    type: Number,
    required: true,
  },
});

module.exports = mongoose.model("Product", productSchema);
