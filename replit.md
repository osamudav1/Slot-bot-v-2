# Advanced Telegram Economy Bot

A feature-rich Telegram group economy bot built with Node.js, Telegraf.js, and MongoDB.

## Features
- Auto salary system with captcha security
- Dynamic central bank
- In-group market with buyable items
- Gambling (slot machine, Shan Ko Mee card game)
- Random events (catch, grab, guess mini-games)
- User ranking system
- Owner broadcast and admin tools

## Stack
- **Runtime**: Node.js 20
- **Bot framework**: Telegraf.js v4
- **Database**: MongoDB via Mongoose
- **Language support**: English (`en`) and Turkish (`tr`)

## Project structure
```
src/
  index.js          # Entry point — bot init, middleware, scene/command loading
  logger.js         # Logging utility
  products.js       # Item/product definitions
  database/         # Mongoose connection + entity schemas
  commands/         # Bot command handlers (one file per command)
  scenes/           # Telegraf scenes (multi-step interactions)
  handlers/         # Event handlers (e.g. case/crate events)
  modules/          # Business logic modules (user, group, bank, etc.)
  lang/             # Localisation strings (en / tr)
  assets/           # Static assets (bot logo, etc.)
  store/            # Shared in-memory store
```

## Running the bot
The bot requires these environment variables:

| Variable            | Description                          |
|---------------------|--------------------------------------|
| `TELEGRAM_BOT_TOKEN`| From [@BotFather](https://t.me/BotFather) |
| `MONGODB_URI`       | MongoDB connection string (e.g. Atlas) |
| `LANG`              | `en` or `tr`                         |
| `OWNER_ID`          | Your Telegram numeric user ID        |

Install dependencies first:
```bash
npm install
```

Then start:
```bash
npm start
```

## User preferences
- User is browsing/editing code; no run workflow configured by request.
