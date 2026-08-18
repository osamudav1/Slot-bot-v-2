const mongoose = require("mongoose");
const logger = require("../logger");
require("dotenv").config();

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in environment variables");
    }
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.DB_NAME || "waifu_bot",
      // Keep enough connections for concurrent games without exhausting a small Render instance.
      minPoolSize: 5,
      maxPoolSize: 50,
      maxIdleTimeMS: 30000,
      // Never let a dropped MongoDB connection hold a game forever.
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 10000,
      waitQueueTimeoutMS: 5000,
    });
    logger.success(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    logger.error(`MongoDB Connection Error: ${error.message}`);
    // Don't exit here, let the main function handle it
    throw error;
  }
};

module.exports = { connectDB, mongoose };
