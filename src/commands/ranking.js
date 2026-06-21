const { Composer } = require("telegraf");
const { findUser } = require("../modules/user.module");
const { getString, getCommandName } = require("../lang/index");

module.exports = Composer.command(getCommandName("ranking"), async (ctx) => {
  const mostRichestPeople = await findUser({
    order: {
      balance: "DESC",
    },
    take: 10,
  });

  let mostRichestPeopleAsText = "";

  for (const person of mostRichestPeople) {
    mostRichestPeopleAsText = mostRichestPeopleAsText + `💰 [${getString("CLICK_TO_SEE_PROFILE")}](tg://user?id=${person.id})   -  ${person.balance} MMK\n`;
  }

  return ctx.replyWithMarkdown(mostRichestPeopleAsText);
});
