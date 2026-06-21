const { Telegraf, Composer, session, Scenes } = require("telegraf");
const logger = require("./logger");
const dotenv = require("dotenv");
const fs = require("fs");
const express = require("express");
const { connectDB } = require("./database/index");
const { getCommandName } = require("./lang/index");
const handleCaseEvent = require("./handlers/handle.case");
const { getGroup, createGroupRequest, getTotalGroups } = require("./modules/group.module");
const { Markup } = require("telegraf");

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
    { command: "register", description: "Activate group (Owner only)" },
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

    bot.on("new_chat_members", async (ctx) => {
      const isBotAdded = ctx.message.new_chat_members.some(
        (member) => member.id === ctx.botInfo.id
      );

      if (isBotAdded) {
        const ownerId = process.env.OWNER_ID;
        const groupId = ctx.chat.id.toString();
        const groupName = ctx.chat.title;
        const groupLink = ctx.chat.username ? `https://t.me/${ctx.chat.username}` : "No link";
        const addedBy = ctx.from.first_name + (ctx.from.last_name ? " " + ctx.from.last_name : "") + ` (@${ctx.from.username || "N/A"})`;
        
        await createGroupRequest(groupId, groupName);
        const totalGroups = await getTotalGroups();

        if (ownerId) {
          const ownerMsg = `📢 Bot added to a new group!\n\n` +
            `Group ID: ${groupId}\n` +
            `Add user mentioned: ${addedBy}\n` +
            `Group name: ${groupName}\n` +
            `Group link: ${groupLink}\n` +
            `Total Gp count: ${totalGroups}`;
          
          await ctx.telegram.sendMessage(ownerId, ownerMsg).catch(err => logger.error("Failed to notify owner: " + err.message));
        }

        return ctx.reply(
          "ဘော့အသုံးပြုလိုပါက owner ကိုဆက်သွယ်ပါ",
          Markup.inlineKeyboard([
            [Markup.button.url("Owner", `tg://user?id=${ownerId}`)]
          ])
        );
      }
    });

    bot.on("message", async (ctx, next) => {
      if (ctx.chat.type === "private") {
        const ownerId = process.env.OWNER_ID;
        if (ctx.from.id.toString() !== ownerId) {
          return ctx.reply("This bot only works in groups.");
        }
      } else {
        const group = await getGroup(ctx.chat.id.toString());
        if (!group || !group.isActive) {
          // If not registered, ignore messages unless it's /register from owner
          if (ctx.message.text === "/register" && ctx.from.id.toString() === process.env.OWNER_ID) {
            return next();
          }
          return;
        }
      }
      return next();
    });

    bot.on("message", async (ctx) => {
      await handleCaseEvent(ctx);
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
