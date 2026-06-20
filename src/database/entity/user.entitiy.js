const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true,
  },
  balance: {
    type: Number,
    default: 0,
  },
  last_payback_time: {
    type: Number,
    default: 0,
  },
  case: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("User", userSchema);
