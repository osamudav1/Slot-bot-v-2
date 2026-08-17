const { Telegraf, Composer, Scenes, session, Markup } = require("telegraf");
const logger = require("./logger");
const dotenv = require("dotenv");
const fs = require("fs");
const express = require("express");
const { connectDB, mongoose } = require("./database/index");
const { getCommandName } = require("./lang/index");
const handleCaseEvent = require("./handlers/handle.case");
const { getGroup, createGroupRequest, getTotalGroups, registerGroup } = require("./modules/group.module");
const { getUser } = require("./modules/user.module");
const { isMaintenanceEnabled } = require("./modules/maintenance.module");

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
    { command: getCommandName("bank") || "wallet", description: "Check both wallet balances" },
    { command: "bal", description: "Check both wallet balances" },
    { command: "exchange", description: "Move funds between Waifu and Slot wallets" },
    { command: getCommandName("salary") || "salary", description: "Get your salary" },
    { command: getCommandName("slot") || "slot", description: "Play slot machine" },
    { command: getCommandName("shan") || "shan", description: "Play Shan Ko Mee" },

    { command: "daily", description: "Claim your daily reward" },
    { command: "mgift", description: "Send money (Reply to user)" },
    { command: getCommandName("ranking") || "ranking", description: "View top players" },

    { command: getCommandName("case") || "case", description: "Open a crate" },
    { command: "gbuy", description: "Exchange cards" },
    { command: "buys", description: "Buy GRAM with USD" },
  ];

  const ownerCommands = [
    ...userCommands,
    { command: getCommandName("add") || "add", description: "Add/Remove balance (Owner only)" },
    { command: "register", description: "Activate group (Owner only)" },
    { command: "broadcast", description: "Broadcast message to all users" },
    { command: "logs", description: "View user list" },
    { command: "glogs", description: "View group list" },
    { command: "guess", description: "Guess Bot ON/OFF" },
    { command: "catch", description: "Catch Bot ON/OFF" },
    { command: "grab", description: "Grab Bot ON/OFF" },
    { command: "addpool", description: "Add money to payout pool (Owner only)" },
    { command: "ownerhelp", description: "Owner control panel (Owner only)" },
    { command: "pool", description: "View payout pool (Owner only)" },
    { command: "setwin", description: "Set base win rate (Owner only)" },
    { command: "setlimit", description: "Set bet limits (Owner only)" },
    { command: "setcooldown", description: "Set game cooldown (Owner only)" },
    { command: "pausegame", description: "Pause or resume games (Owner only)" },
    { command: "user", description: "View user balance (Owner only)" },
    { command: "adjust", description: "Adjust user balance (Owner only)" },
    { command: "stats", description: "View bot statistics (Owner only)" },
    { command: "resetcontrol", description: "Reset owner controls (Owner only)" },
    { command: "gramwallet", description: "Configure GRAM wallet (Owner only)" },
    { command: "maintenance", description: "Maintenance ON/OFF (Owner only)" },
    { command: "gramdeposits", description: "View GRAM top-up records (Owner only)" },
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
  
  // Enable auto-registration for groups
  global.autoRegister = true;

  // 🆕 BOT START TIME - မက်ဆေ့ခ်ျဟောင်းတွေကို စစ်ထုတ်ဖို့
  const BOT_START_TIME = Date.now();

  const app = express();
  const PORT = process.env.PORT || 3000;
  let botReady = false;
  let botStarted = false;
  const publicUrl = String(process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  const useWebhook = process.env.BOT_MODE === "webhook" || Boolean(publicUrl);

  app.use(express.json());
  app.get("/", (req, res) => res.status(200).send("OK"));
  // Liveness endpoint: return 200 as soon as the process is listening.
  // Deployment platforms use this endpoint to decide whether to keep the container alive.
  app.get("/health", (req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    return res.status(200).json({ ok: true, botReady, dbReady });
  });

  // Readiness endpoint: useful for diagnostics without causing deployment restarts.
  app.get("/ready", (req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    const ready = botReady && dbReady;
    return res.status(ready ? 200 : 503).json({ ok: ready, botReady, dbReady });
  });
  
  const server = app.listen(PORT, "0.0.0.0", () => {
    logger.success(`Health check server is running on port ${PORT}`);
  });

  try {
    await connectDB();
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

    bot.catch((error) => {
      logger.error(`Telegram update error: ${error.message}`);
    });

    bot.use(session());

    // Registration and Owner Check Middleware
    bot.use(async (ctx, next) => {
      if (!ctx.from || ctx.from.is_bot) return next();
      
      const ownerId = process.env.OWNER_ID;
      const currentUserId = ctx.from.id.toString();

      // Owner can always access the bot so maintenance can be switched off.
      // Do not let a stalled MongoDB query block Telegram updates indefinitely.
      let maintenanceEnabled = false;
      if (currentUserId !== String(ownerId || "")) {
        try {
          maintenanceEnabled = await Promise.race([
            isMaintenanceEnabled(),
            new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
          ]);
        } catch (maintenanceError) {
          logger.error(`Maintenance lookup error: ${maintenanceError.message}`);
        }
      }
      if (maintenanceEnabled) {
        if (ctx.chat?.type === "private") {
          await ctx.reply("🛠 Maintenance ပြုလုပ်နေသည်။ ခဏနောက် ထပ်ကြိုးစားပါ။");
        }
        return;
      }

      // User synchronization and first-user notification must never delay /start.
      // They run in the background while the command handler continues immediately.
      User.findOne({ id: Number(ctx.from.id) })
        .then((existingUser) => {
          if (!existingUser && ownerId) {
            const newUserMsg = `🆕 New User Notification!\n\n` +
              `User Name: ${ctx.from.first_name}${ctx.from.last_name ? " " + ctx.from.last_name : ""}\n` +
              `User ID: ${ctx.from.id}\n` +
              `Username: @${ctx.from.username || "N/A"}`;
            return bot.telegram.sendMessage(ownerId, newUserMsg);
          }
        })
        .catch((userLookupError) => logger.error(`User lookup error: ${userLookupError.message}`));

      getUser({ id: ctx.from.id, firstName: ctx.from.first_name })
        .catch(err => logger.error("User sync error: " + err.message));

      if (ctx.chat?.type === "private") {
        return next();
      } else if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
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

    if (useWebhook) {
      if (!publicUrl) {
        throw new Error("BOT_MODE=webhook requires WEBHOOK_URL or RENDER_EXTERNAL_URL");
      }
      const webhookPath = "/telegram/webhook";
      app.post(webhookPath, bot.webhookCallback(webhookPath));
      await bot.telegram.setWebhook(`${publicUrl}${webhookPath}`, {
        drop_pending_updates: true,
      });
      botStarted = true;
      logger.success(`Telegram bot started in webhook mode: ${publicUrl}${webhookPath}`);
    } else {
      // Polling is kept for local development. Render uses webhook mode to avoid 409 conflicts during deploys.
      await bot.launch({ dropPendingUpdates: true });
      botStarted = true;
      logger.success("Telegram bot started in polling mode");
    }

    botReady = true;

    const shutdown = async (signal) => {
      try {
        if (botStarted && !useWebhook) bot.stop(signal);
        if (botStarted && useWebhook) await bot.telegram.deleteWebhook({ drop_pending_updates: false });
      } catch (error) {
        logger.error(`Shutdown error: ${error.message}`);
      } finally {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
      }
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));

  } catch (error) {
    botReady = false;
    logger.error(`Failed to start application: ${error.message}`);
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000).unref();
  }
};

main();
