const { Telegraf, Composer, session, Scenes } = require("telegraf");
const logger = require("./logger");
const dotenv = require("dotenv");
const fs = require("fs");
const express = require("express");
const { connectDB } = require("./database/index");
const { getCommandName } = require("./lang/index");
const handleCaseEvent = require("./handlers/handle.case");
const { getGroup, createGroupRequest, getTotalGroups, registerGroup } = require("./modules/group.module");
const { getUser } = require("./modules/user.module");
const { Markup } = require("telegraf");
const User = require("./database/entity/user.entitiy");

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
    { command: getCommandName("bank") || "bank", description: "Check your balance" },
    { command: getCommandName("salary") || "salary", description: "Get your salary" },
    { command: getCommandName("slot") || "slot", description: "Play slot machine" },
    { command: getCommandName("shan") || "shan", description: "Play Shan Ko Mee" },
    { command: "gmarket", description: "View market items" },
    { command: "daily", description: "Claim your daily reward" },
    { command: "mgift", description: "Send money (Reply to user)" },
    { command: getCommandName("ranking") || "ranking", description: "View top players" },
    { command: getCommandName("centralbank") || "centralbank", description: "View central bank" },
    { command: getCommandName("case") || "case", description: "Open a crate" },
  ];

  const ownerCommands = [
    ...userCommands,
    { command: getCommandName("add") || "add", description: "Add/Remove balance (Owner only)" },
    { command: "register", description: "Activate group (Owner only)" },
    { command: "broadcast", description: "Broadcast message to all users" },
    { command: "logs", description: "View user list" },
    { command: "glogs", description: "View group list" },
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

  // 🆕 BOT START TIME - မက်ဆေ့ခ်ျဟောင်းတွေကို စစ်ထုတ်ဖို့
  const BOT_START_TIME = Date.now();

  const app = express();
  const PORT = process.env.PORT || 3000;
  app.get("/", (req, res) => res.status(200).send("OK"));
  app.get("/health", (req, res) => res.status(200).send("OK"));
  
  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.success(`Health check server is running on port ${PORT}`);
  });

  connectDB().catch(err => logger.error("Initial DB connection failed: " + err.message));

  try {
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

    bot.use(session());

    // Registration and Owner Check Middleware
    bot.use(async (ctx, next) => {
      if (!ctx.from || ctx.from.is_bot) return next();
      
      const ownerId = process.env.OWNER_ID;
      const currentUserId = ctx.from.id.toString();

      // Check for new user (first time start or message)
      const existingUser = await User.findOne({ id: ctx.from.id });
      if (!existingUser) {
        if (ownerId) {
          const newUserMsg = `🆕 New User Notification!\n\n` +
            `User Name: ${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}\n` +
            `User ID: ${ctx.from.id}\n` +
            `Username: @${ctx.from.username || "N/A"}`;
          
          await bot.telegram.sendMessage(ownerId, newUserMsg).catch(err => logger.error("Failed to notify owner about new user: " + err.message));
        }
      }

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
        
        // If manual registration is OFF (autoRegister is true), auto-register if not active
        if (global.autoRegister && (!group || !group.isActive)) {
          let groupLink = ctx.chat.username ? `https://t.me/${ctx.chat.username}` : null;
          await registerGroup(ctx.chat.id.toString(), ctx.chat.title, ownerId, groupLink).catch(e => logger.error("Auto-register error: " + e.message));
          return next();
        }

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
        
        await createGroupRequest(groupId, groupName, groupLink);
        const totalGroups = await getTotalGroups();

        if (ownerId) {
          const ownerMsg = `📢 Bot added to a new group!\n\n` +
            `Add user name: ${addedBy}\n` +
            `Group id: ${groupId}\n` +
            `Group link: ${groupLink}\n` +
            `Total count: ${totalGroups}`;
          
          await ctx.telegram.sendMessage(ownerId, ownerMsg).catch(err => logger.error("Failed to notify owner: " + err.message));
        }

        // Auto-register if global.autoRegister is true
        if (global.autoRegister) {
            await registerGroup(groupId, groupName, ownerId, groupLink).catch(e => logger.error("Auto-register on join error: " + e.message));
            return ctx.reply("♻️ Approved ♻️ (Auto-registered)");
        }

        return ctx.reply(
          "bot အသုံးပြရန် owner မှ Group ကိုregister လုပ်ပေးရန်လိုအပ်ပါသည်\n\nအသုံးပြုလိုပါက ဆက်သွယ်ပေးပါ",
          Markup.inlineKeyboard([
            [Markup.button.url("Owner", `tg://user?id=${ownerId}`)]
          ])
        );
      }
    });

    await loadScenes(bot);
    await loadCommands(bot);
    await setBotCommands(bot);

    // 🆕 MESSAGE HANDLER - မက်ဆေ့ခ်ျဟောင်းတွေကို စစ်ထုတ်မယ်
    bot.on("message", async (ctx) => {
      // Bot စတင်ချိန်ထက် စောတဲ့ မက်ဆေ့ခ်ျတွေကို ignore လုပ်
      if (ctx.message.date * 1000 < BOT_START_TIME) {
        logger.info(`⏭️ Skipping old message from ${ctx.from.id} (${ctx.message.date})`);
        return;
      }
      await handleCaseEvent(ctx);
    });

    // 🆕 LAUNCH - pending updates တွေကို ရှင်းပစ်မယ်
    await bot.launch({
      dropPendingUpdates: true
    });

    logger.success("Telegram bot started");

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
