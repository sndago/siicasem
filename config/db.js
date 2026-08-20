const mongoose = require('mongoose');
const logger = require('./logger');
// const seed = require('./seed');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  try {
    logger.info('Connecting to MongoDB…');
    await mongoose.connect(uri);
    logger.success(`MongoDB connected @ ${uri.replace(/\/\/.*@/, '//<redacted>@')}`);
  } catch (error) {
    logger.error('MongoDB connection failed', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
