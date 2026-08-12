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
  case: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("User", userSchema);
