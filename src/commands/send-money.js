const { Composer } = require("telegraf");
const { getUser, setUser } = require("../modules/user.module");
const { getString, getCommandName } = require("../lang/index");
const { increaseBankAmount } = require("../modules/bank.module");

const sendMoneyHandler = async (ctx) => {
  const taxRate = 0; 
  const cmd = ctx.message.text.split(" ")[0].replace("/", "");
  
  // Check if it's a reply
  const replyToMessage = ctx.message.reply_to_message;
  if (!replyToMessage || !replyToMessage.from) {
    return ctx.reply(`Usage: Reply to a user's message with /${cmd} <amount>`);
  }

  const targetUser = replyToMessage.from;
  const senderId = ctx.from.id;

  if (senderId === targetUser.id) {
    return ctx.reply(getString("SELF_SEND"));
  }

  const args = ctx.message.text.split(" ");
  const moneyAmount = Math.floor(parseFloat(args[1]) * 100);

  if (isNaN(moneyAmount) || moneyAmount <= 0) {
    return ctx.reply(`Please provide a valid amount in dollars. Example: /${cmd} 10.5`);
  }

  const user = await getUser({ id: senderId });

  if (!user || user.coins < moneyAmount) {
    return ctx.reply(getString("NO_BALANCE"));
  }

  // Deduct from sender
  user.coins -= moneyAmount;
  await setUser({ user });

  // Add to recipient
  const targetUserEntity = await getUser({ id: targetUser.id });
  targetUserEntity.coins += moneyAmount;
  await setUser({ user: targetUserEntity });

  const formattedAmount = `$${(moneyAmount / 100).toFixed(2)}`;
  return ctx.reply(`✅ Successfully sent ${formattedAmount} to ${targetUser.first_name || 'user'}.`);
};

const composer = new Composer();
composer.command("mgift", sendMoneyHandler);
composer.command("sendmoney", sendMoneyHandler); // Keep old one just in case

module.exports = composer;
