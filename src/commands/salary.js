const { Composer } = require("telegraf");
const { getCommandName } = require("../lang");

const composer = new Composer();

composer.command(getCommandName("salary"), async (ctx) => {
  return ctx.scene.enter("salary");
});

module.exports = composer;
