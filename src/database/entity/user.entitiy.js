const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true,
    index: true,
  },
  coins: {
    type: Number,
    default: 0,
  },
  // Gambling-only wallet; amounts are stored in cents like coins.
  slot_wallet: {
    type: Number,
    default: 0,
    min: 0,
  },
  last_payback_time: {
    type: Number,
    default: 0,
  },
  last_daily_time: {
    type: Number,
    default: 0,
  },
  first_name: {
    type: String,
    default: "User",
  },
  gram_wallet: {
    type: String,
    default: null,
    index: true,
  },
  case: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("User", userSchema);
