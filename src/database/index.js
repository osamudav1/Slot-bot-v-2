const mongoose = require("mongoose");
const logger = require("../logger");
require("dotenv").config();

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in environment variables");
    }
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    logger.success(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    logger.error(`MongoDB Connection Error: ${error.message}`);
    // Don't exit here, let the main function handle it
    throw error;
  }
};

module.exports = { connectDB, mongoose };
