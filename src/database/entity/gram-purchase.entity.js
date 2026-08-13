const mongoose = require("mongoose");

const gramPurchaseSchema = new mongoose.Schema(
  {
    purchaseId: { type: String, required: true, unique: true, index: true },
    userId: { type: Number, required: true, index: true },
    senderWallet: { type: String, required: true, index: true },
    usdCents: { type: Number, required: true, min: 100000 },
    gramNano: { type: String, required: true },
    comment: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["pending", "credited", "expired", "failed"],
      default: "pending",
      index: true,
    },
    txHash: { type: String, unique: true, sparse: true, index: true },
    observedAmountNano: { type: String },
    paidAt: { type: Date },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

gramPurchaseSchema.index({ status: 1, expiresAt: 1 });
module.exports = mongoose.model("GramPurchase", gramPurchaseSchema);
