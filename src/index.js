const { Telegraf, Composer, session, Scenes } = require("telegraf");
const logger = require("./logger");
const dotenv = require("dotenv");
const fs = require("fs");
const express = require("express");
const { connectDB } = require("./database/index");
const { getCommandName } = require("./lang/index");
const handleCaseEvent = require("./handlers/handle.case");
const { getGroup, createGroupRequest, getTotalGroups } = require("./modules/group.module");
const { getUser } = require("./modules/user.module");
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
  const ownerId = process.env.OWNER_ID;

  const userCommands = [
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
  ];

  const ownerCommands = [
    ...userCommands,
    { command: getCommandName("add"), description: "Add/Remove balance (Owner only)" },
    { command: "register", description: "Activate group (Owner only)" },
  ];

  // Default commands for everyone
  await bot.telegram.setMyCommands(userCommands);

  // Special commands for the owner
  if (ownerId) {
    try {
      await bot.telegram.setMyCommands(ownerCommands, {
        scope: { type: "chat", chat_id: parseInt(ownerId) },
      });
    } catch (err) {
      logger.error(`Failed to set owner commands: ${err.message}`);
    }
  }

  logger.success("Bot commands menu updated with owner separation");
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

    // Registration and Owner Check Middleware (MUST BE BEFORE COMMANDS)
    bot.use(async (ctx, next) => {
      if (!ctx.from || ctx.from.is_bot) return next();
      
      const ownerId = process.env.OWNER_ID;
      const currentUserId = ctx.from.id.toString();

      // Update user info in background
      getUser({ id: ctx.from.id, firstName: ctx.from.first_name }).catch(err => logger.error("User sync error: " + err.message));

      if (ctx.chat.type === "private") {
        if (ownerId && currentUserId !== ownerId) {
          return; // Silent in private if not owner
        }
      } else if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        const group = await getGroup(ctx.chat.id.toString());
        const text = ctx.message?.text || "";
        const isRegisterCommand = text.startsWith("/register");
        
        if (!group || !group.isActive) {
          // If not registered, only allow /register from owner
          if (isRegisterCommand && currentUserId === ownerId) {
            return next();
          }
          return; // Strictly silent in unregistered groups
        }
      }
      return next();
    });

    bot.on("new_chat_members", async (ctx) => {
      const isBotAdded = ctx.message.new_chat_members.some(
        (member) => member.id === ctx.botInfo.id
      );

      if (isBotAdded) {
        const ownerId = process.env.OWNER_ID;
        const groupId = ctx.chat.id.toString();
        const groupName = ctx.chat.title;
        let groupLink = ctx.chat.username ? `https://t.me/${ctx.chat.username}` : "No public link";
        
        if (!ctx.chat.username) {
          try {
            groupLink = await ctx.telegram.exportChatInviteLink(ctx.chat.id);
          } catch (e) {
            groupLink = "Could not generate invite link (Bot needs admin rights)";
          }
        }
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

    await loadScenes(bot);
    await loadCommands(bot);
    await setBotCommands(bot);

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
