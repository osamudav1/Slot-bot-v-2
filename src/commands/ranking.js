const { Composer } = require("telegraf");
const { findUser } = require("../modules/user.module");
const { getString, getCommandName } = require("../lang/index");

const composer = new Composer();

composer.command(getCommandName("ranking"), async (ctx) => {
  const mostRichestPeople = await findUser({
    order: {
      coins: "DESC",
    },
    take: 10,
  });

  let mostRichestPeopleAsText = "";

  for (const person of mostRichestPeople) {
    mostRichestPeopleAsText = mostRichestPeopleAsText + `💰 [${person.first_name || "User"}](tg://user?id=${person.id})\n`;
  }

  return ctx.replyWithMarkdown(mostRichestPeopleAsText);
});

module.exports = composer;
