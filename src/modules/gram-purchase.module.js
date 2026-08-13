const GramPurchase = require("../database/entity/gram-purchase.entity");
const User = require("../database/entity/user.entitiy");
const { mongoose } = require("../database");
const {
  PAYMENT_TTL_MS,
  calculateGramNano,
  makePurchaseId,
  makeComment,
  findIncomingGramPayment,
} = require("./gram-payment.module");

async function createPurchase({ userId, usdCents, senderWallet }) {
  const gramNano = calculateGramNano(usdCents);
  const purchaseId = makePurchaseId();
  const comment = makeComment(purchaseId);
  const purchase = await GramPurchase.create({
    purchaseId,
    userId: Number(userId),
    senderWallet,
    usdCents,
    gramNano,
    comment,
    expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
  });
  return purchase;
}

async function expirePurchase(purchase) {
  if (purchase.status === "pending" && purchase.expiresAt <= new Date()) {
    await GramPurchase.updateOne({ _id: purchase._id, status: "pending" }, { $set: { status: "expired" } });
    return true;
  }
  return false;
}

async function verifyAndCreditPurchase({ purchaseId }) {
  const purchase = await GramPurchase.findOne({ purchaseId });
  if (!purchase) return { status: "not_found" };
  if (purchase.status === "credited") return { status: "already_credited", purchase };
  if (await expirePurchase(purchase)) return { status: "expired" };

  const payment = await findIncomingGramPayment({ comment: purchase.comment, expectedNano: purchase.gramNano, expectedSender: purchase.senderWallet });
  if (!payment) return { status: "not_found_on_chain" };

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const claimed = await GramPurchase.findOneAndUpdate(
        { _id: purchase._id, status: "pending", expiresAt: { $gt: new Date() } },
        {
          $set: {
            status: "credited",
            txHash: payment.txHash,
            observedAmountNano: payment.amountNano,
            paidAt: payment.paidAt,
          },
        },
        { new: true, session }
      );
      if (!claimed) {
        const current = await GramPurchase.findById(purchase._id).session(session);
        result = current?.status === "credited" ? { status: "already_credited", purchase: current } : { status: "not_found_on_chain" };
        return;
      }
      await User.findOneAndUpdate(
        { id: purchase.userId },
        { $inc: { coins: purchase.usdCents } },
        { upsert: true, new: true, setDefaultsOnInsert: true, session }
      );
      result = { status: "credited", purchase: claimed };
    });
    return result;
  } catch (error) {
    if (error?.code === 11000) return { status: "already_credited" };
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { createPurchase, verifyAndCreditPurchase };
