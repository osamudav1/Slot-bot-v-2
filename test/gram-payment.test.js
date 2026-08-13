process.env.GRAM_USD_CENTS_PER_GRAM = "1000000";
process.env.GRAM_MIN_USD_CENTS = "100000";

const assert = require("assert");
const {
  calculateGramNano,
  formatGramNano,
  makeComment,
} = require("../src/modules/gram-payment.module");

assert.strictEqual(calculateGramNano(200000), "200000000");
assert.strictEqual(formatGramNano("200000000"), "0.2");
assert.strictEqual(calculateGramNano(100000), "100000000");
assert.throws(() => calculateGramNano(99999));
assert.throws(() => calculateGramNano(200050));
assert.match(makeComment("abc"), /^slotbot:abc$/);
console.log("GRAM payment tests passed");
