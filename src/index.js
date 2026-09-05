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
const { isOwner } = require("./modules/owner.module");
const { migrateLegacyWallet } = require("./modules/slot-wallet.module");

const User = require("./database/entity/user.entitiy");

const withTimeout = (promise, timeoutMs, label) => Promise.race([
  promise,
  new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
  }),
]);

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

  // User menu: gameplay, wallet, and normal utility commands only.
  // Owner-only controls are deliberately excluded from all user scopes.
  const userCommands = [
    { command: "start", description: "Bot စတင်ရန်" },
    { command: "wallet", description: "Wallet လက်ကျန်ကြည့်ရန်" },
    { command: "pool", description: "Payout pool စစ်ရန်" },
    { command: "exchange", description: "Waifu နှင့် wallet လဲလှယ်ရန်" },
    { command: "slot", description: "Slot ဆော့ရန်" },
    { command: "shan", description: "ရှမ်းကိုးမီး ဆော့ရန်" },
    { command: "ranking", description: "အဆင့်စာရင်းကြည့်ရန်" },
    { command: "daily", description: "နေ့စဉ်ဆုယူရန်" },
    { command: "salary", description: "လစာဆုယူရန်" },
    { command: "case", description: "Case ဖွင့်ရန်" },
    { command: "mgift", description: "ငွေလွှဲရန်" },
  ];

  // Owner DM menu: all normal commands plus every owner control.
  const ownerCommands = [
    ...userCommands,
    { command: "help", description: "အကူအညီကြည့်ရန်" },
    { command: "ownerhelp", description: "Owner command အားလုံး" },
    { command: "addpool", description: "Payout pool ထည့်ရန်" },
    { command: "setwin", description: "Win rate သတ်မှတ်ရန်" },
    { command: "setlimit", description: "Bet limit သတ်မှတ်ရန်" },
    { command: "setcooldown", description: "Cooldown သတ်မှတ်ရန်" },
    { command: "pausegame", description: "Game ခဏရပ်/ဖွင့်ရန်" },
    { command: "user", description: "User balance စစ်ရန်" },
    { command: "adjust", description: "User balance ပြင်ရန်" },
    { command: "stats", description: "Bot statistics ကြည့်ရန်" },
    { command: "resetcontrol", description: "Control settings reset" },
    { command: "dailyreset", description: "Reset daily spins for all users" },
    { command: "maintenance", description: "Maintenance mode" },
    { command: "register", description: "Group register လုပ်ရန်" },
    { command: "logs", description: "Logs ကြည့်ရန်" },
    { command: "glogs", description: "Guess logs ကြည့်ရန်" },
    { command: "gramwallet", description: "Gram wallet စစ်ရန်" },
    { command: "gramdeposits", description: "Gram deposits ကြည့်ရန်" },
    { command: "wlj", description: "Slot Win/Lose settings" },
  ];

  const userScopes = [
    { type: "all_private_chats" },
    { type: "all_group_chats" },
  ];

  // Clear default and user scopes first so Telegram does not retain old menus.
  await bot.telegram.deleteMyCommands().catch((err) =>
    logger.error(`Failed to clear default command scope: ${err.message}`)
  );
  await bot.telegram.setMyCommands(userCommands).catch((err) =>
    logger.error(`Failed to set default command menu: ${err.message}`)
  );
  for (const scope of userScopes) {
    await bot.telegram.deleteMyCommands({ scope }).catch((err) =>
      logger.error(`Failed to clear command scope ${scope.type}: ${err.message}`)
    );
    await bot.telegram.setMyCommands(userCommands, { scope }).catch((err) =>
      logger.error(`Failed to set command scope ${scope.type}: ${err.message}`)
    );
  }

  // Only the owner’s private chat receives the full owner command menu.
  const ownerChatId = Number(ownerId);
  if (Number.isSafeInteger(ownerChatId) && ownerChatId > 0) {
    const ownerScope = { type: "chat", chat_id: ownerChatId };
    await bot.telegram.deleteMyCommands({ scope: ownerScope }).catch((err) =>
      logger.error(`Failed to clear owner command scope: ${err.message}`)
    );
    await bot.telegram.setMyCommands(ownerCommands, { scope: ownerScope }).catch((err) =>
      logger.error(`Failed to set owner command scope: ${err.message}`)
    );
  }

  logger.success("User and owner command menus configured");
};

const main = async () => {
  dotenv.config();

  // Render and the project documentation use TELEGRAM_BOT_TOKEN. Keep
  // BOT_TOKEN as a backwards-compatible fallback for older deployments.
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || "").trim();
  if (!botToken) {
    throw new Error(
      "Telegram bot token is missing. Set TELEGRAM_BOT_TOKEN in the deployment environment."
    );
  }

  process.on("unhandledRejection", (error) => {
    logger.error(`Unhandled promise rejection: ${error?.stack || error}`);
  });
  process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${error?.stack || error}`);
  });
  
  // Groups must be explicitly registered by the owner before commands are usable.
  global.autoRegister = false;

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
    // Slot Wallet balances are persisted in MongoDB and must survive restarts.
    const migration = await migrateLegacyWallet();
    logger.info(`MongoDB-backed Slot Wallet persistence enabled (migrated: ${migration.migrated}, skipped: ${migration.skipped})`);
    const bot = new Telegraf(botToken);

    bot.catch((error) => {
      logger.error(`Telegram update error: ${error.message}`);
    });

    bot.use(session());

    // Registration and Owner Check Middleware
    bot.use(async (ctx, next) => {
      if (!ctx.from || ctx.from.is_bot) return next();
      
      const ownerId = process.env.OWNER_ID;
      const currentUserId = ctx.from.id.toString();
      const currentUserIsOwner = isOwner(ctx);
      const commandText = String(ctx.message?.text || ctx.callbackQuery?.message?.text || "");
      const commandName = commandText.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
      // Read-only commands remain available during maintenance.
      // Core user commands remain available during maintenance checks; the game
      // handlers still enforce their own pause and balance rules.
      const alwaysAllowedCommands = new Set(["/start", "/wallet", "/exchange", "/pool", "/slot", "/shan"]);

      // Owner can always access the bot so maintenance can be switched off.
      // Do not let a stalled MongoDB query block Telegram updates indefinitely.
      let maintenanceEnabled = false;
      if (!currentUserIsOwner) {
        try {
          maintenanceEnabled = await Promise.race([
            isMaintenanceEnabled(),
            new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
          ]);
        } catch (maintenanceError) {
          logger.error(`Maintenance lookup error: ${maintenanceError.message}`);
        }
      }
      if (maintenanceEnabled && !alwaysAllowedCommands.has(commandName)) {
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
        let group;
        try {
          group = await withTimeout(
            getGroup(ctx.chat.id.toString()),
            2000,
            "Group registration lookup"
          );
        } catch (groupLookupError) {
          logger.error(`Group registration lookup failed: ${groupLookupError.message}`);
          await ctx.reply("⚠️ Database ခဏမရသေးပါ။ ခဏနောက် ပြန်စမ်းပါ။").catch(() => {});
          return;
        }
        const text = ctx.message?.text || "";
          const isRegisterCommand = text.startsWith("/register");
          const commandInChat = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
          const isPublicGameCommand = commandInChat === "/pool" || commandInChat === "/slot" || commandInChat === "/shan";
          
          if (!group || !group.isActive) {
          if (global.autoRegister === true) {
            try {
              group = await withTimeout(
                registerGroup(
                  ctx.chat.id.toString(),
                  ctx.chat.title,
                  currentUserId,
                  ctx.chat.username ? `https://t.me/${ctx.chat.username}` : null
                ),
                2000,
                "Automatic group registration"
              );
              logger.info(`Auto-registered group ${ctx.chat.id}`);
              return next();
            } catch (autoRegisterError) {
              logger.error(`Auto registration failed: ${autoRegisterError.message}`);
            }
          }

          // Manual mode: only the owner may register an unregistered group.
          if ((isRegisterCommand && currentUserIsOwner) || isPublicGameCommand) {
            return next();
          }
          if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
            await ctx.reply("⛔ ဤ group ကို owner မှ register မလုပ်ရသေးပါ။");
          }
          return;
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
      // Mount the callback with app.use so Express strips the public prefix.
      // Telegraf then receives the route-local path `/` and accepts the update.
      app.use(webhookPath, bot.webhookCallback("/"));
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
