const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!dbUri) {
      throw new Error('Database connection string is missing! Please set MONGO_URI or MONGODB_URI in environment variables.');
    }
    const conn = await mongoose.connect(dbUri, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`Database connection failed: ${error.message}`);
    // Exiting is right for a running server — there is nothing useful it can
    // do without a database — but it would kill a test runner, so leave that
    // decision to the caller outside production.
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw error;
  }
};

module.exports = connectDB;