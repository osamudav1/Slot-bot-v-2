const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    unique: true,
  },
  groupName: {
    type: String,
  },
  registeredBy: {
    type: String,
  },
  registeredAt: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model("Group", groupSchema);
