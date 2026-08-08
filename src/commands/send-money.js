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
  const moneyAmount = parseInt(args[1]);

  if (isNaN(moneyAmount) || moneyAmount <= 0) {
    return ctx.reply(`Please provide a valid amount. Example: /${cmd} 1000`);
  }

  const user = await getUser({ id: senderId });

  if (!user || user.balance < moneyAmount) {
    return ctx.reply(getString("NO_BALANCE"));
  }

  // Deduct from sender
  user.balance -= moneyAmount;
  await setUser({ user });

  // Add to recipient
  const targetUserEntity = await getUser({ id: targetUser.id });
  targetUserEntity.balance += moneyAmount;
  await setUser({ user: targetUserEntity });

  return ctx.reply(`✅ Successfully sent ${moneyAmount} $ to ${targetUser.first_name || 'user'}.`);
};

const composer = new Composer();
composer.command("mgift", sendMoneyHandler);
composer.command("sendmoney", sendMoneyHandler); // Keep old one just in case

module.exports = composer;
