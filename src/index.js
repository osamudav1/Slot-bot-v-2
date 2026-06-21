const { Telegraf, Composer, session, Scenes } = require("telegraf");
const logger = require("./logger");
const dotenv = require("dotenv");
const fs = require("fs");
const express = require("express");
const { connectDB } = require("./database/index");
const { getCommandName } = require("./lang/index");
const handleCaseEvent = require("./handlers/handle.case");

const loadCommands = async (bot) => {
  logger.info(`Commands loading...`);
  const commandsList = fs.readdirSync(__dirname + "/commands");
  const commands = [];
  for (const command of commandsList) {
    // Skip buy.js and items.js as they are no longer needed
    if (command === "buy.js" || command === "items.js") continue;
    commands.push(require(`./commands/${command}`));
    logger.success(`${command} command loaded`);
  }
  bot.use(Composer.compose(commands));
  logger.info(`All commands loaded`);
};

const loadScenes = async (bot) => {
  logger.info(`Scenes loading...`);
  const scenesList = fs.readdirSync(__dirname + "/scenes");
  const scenes = [];
  for (const scene of scenesList) {
    scenes.push(require(`./scenes/${scene}`));
    logger.success(`${scene} scene loaded`);
  }
  const stage = new Scenes.Stage(scenes);
  bot.use(stage.middleware());
  logger.info(`All scenes loaded`);
};

const setBotCommands = async (bot) => {
  const commands = [
    { command: "start", description: "Start the bot" },
    { command: "help", description: "View purchase rules and help" },
    { command: getCommandName("bank"), description: "Check your balance" },
    { command: getCommandName("salary"), description: "Get your salary" },
    { command: getCommandName("slot"), description: "Play slot machine" },
    { command: getCommandName("market"), description: "View market items" },
    { command: "daily", description: "Claim your daily reward" },
    { command: getCommandName("sendmoney"), description: "Send money (Reply to user)" },
    { command: getCommandName("ranking"), description: "View top players" },
    { command: getCommandName("centralbank"), description: "View central bank" },
    { command: getCommandName("case"), description: "Open a crate" },
    { command: getCommandName("add"), description: "Add/Remove balance (Owner only)" },
  ];
  await bot.telegram.setMyCommands(commands);
  logger.success("Bot commands menu updated");
};

const main = async () => {
  dotenv.config();

  const app = express();
  const PORT = process.env.PORT || 3000;
  app.get("/", (req, res) => res.status(200).send("OK"));
  app.get("/health", (req, res) => res.status(200).send("OK"));
  
  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.success(`Health check server is running on port ${PORT}`);
  });

  try {
    await connectDB();

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

    bot.use(session());

    await loadScenes(bot);
    await loadCommands(bot);
    await setBotCommands(bot);

    bot.on("message", async (ctx) => {
      await handleCaseEvent(ctx);
      // Removed sticker, photo, link, and badword moderation
    });

    await bot.launch(() => {
      logger.success("Telegram bot started");
    });

    process.once("SIGINT", () => {
      bot.stop("SIGINT");
      server.close();
    });
    process.once("SIGTERM", () => {
      bot.stop("SIGTERM");
      server.close();
    });

  } catch (error) {
    logger.error(`Failed to start application: ${error.message}`);
  }
};

main();
