require('dotenv').config();
const { validate } = require('./config/env');
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./config/logger');
const Client      = require('./models/Client');
const Transaction = require('./models/Transaction');
const Loan        = require('./models/Loan');
const Account     = require('./models/Account');
const User        = require('./models/User');
const { sendSms } = require('./utils/smsService');

try {
  validate();
} catch (err) {
  logger.error('Startup aborted', err.message);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

const runArchiveCleanup = async () => {
  try {
    const cutoff = new Date(Date.now() - SIXTY_DAYS_MS);

    // Find expired clients and cascade-delete their transactions
    const expiredClients = await Client.find({ isDeleted: true, deletedAt: { $lte: cutoff } }).select('_id').lean();
    if (expiredClients.length) {
      const ids = expiredClients.map(c => c._id);
      await Transaction.deleteMany({ client: { $in: ids } });
      await Client.deleteMany({ _id: { $in: ids } });
      logger.info(`Archive cleanup: permanently deleted ${ids.length} client(s) and their transactions`);
    }

    // Delete individually expired transactions
    const txnResult = await Transaction.deleteMany({ isDeleted: true, deletedAt: { $lte: cutoff } });
    if (txnResult.deletedCount) {
      logger.info(`Archive cleanup: permanently deleted ${txnResult.deletedCount} transaction(s)`);
    }

    // Delete expired users
    const userResult = await User.deleteMany({ isDeleted: true, deletedAt: { $lte: cutoff } });
    if (userResult.deletedCount) {
      logger.info(`Archive cleanup: permanently deleted ${userResult.deletedCount} user(s)`);
    }
  } catch (err) {
    logger.error('Archive cleanup failed', err.message);
  }
};

const FREQ_MONTHS = { monthly: 1, quarterly: 3, annually: 12 };

const addMonths = (date, n) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};

const runInterestDebit = async () => {
  try {
    const now = new Date();
    const dueLoans = await Loan.find({
      status: 'active',
      nextInterestDate: { $lte: now },
    }).populate('account').populate('client', 'name phone');

    let charged = 0;
    for (const loan of dueLoans) {
      const account = loan.account;
      if (!account || account.status !== 'active' || account.balance <= 0) continue;

      // First period uses initialRate, all subsequent periods use subsequentRate
      const rate     = loan.periodsCharged === 0 ? loan.initialRate : loan.subsequentRate;
      const interest = parseFloat((account.balance * rate / 100).toFixed(2));
      if (interest <= 0) continue;

      const newBalance = parseFloat((account.balance - interest).toFixed(2));
      const periodLabel = loan.periodsCharged === 0 ? `initial ${rate}%` : `${rate}%`;

      await Transaction.create({
        client:       loan.client,
        account:      account._id,
        type:         'debit',
        amount:       interest,
        description:  `Auto interest — ${periodLabel} (${loan.interestFrequency})`,
        category:     'interest',
        balanceAfter: newBalance,
        status:       'completed',
        date:         now,
      });

      account.balance = newBalance;
      await account.save();

      loan.periodsCharged  += 1;
      loan.nextInterestDate = addMonths(loan.nextInterestDate, FREQ_MONTHS[loan.interestFrequency] || 1);

      const endDate = addMonths(loan.startDate, loan.amortization);
      if (newBalance <= 0 || now >= endDate) {
        loan.status = 'completed';
      }
      await loan.save();

      if (loan.client) {
        sendSms(loan.client.phone, `Dear ${loan.client.name}, loan interest of ₵${interest.toFixed(2)} (${periodLabel}) was charged. New balance: ₵${newBalance.toFixed(2)}. - Siicasem`);
      }

      charged++;
    }

    if (charged) logger.info(`Interest debit: charged ${charged} loan(s)`);
  } catch (err) {
    logger.error('Interest debit job failed', err.message);
  }
};

const startServer = async () => {
  await connectDB();

  // Run cleanup once on startup, then every 24 hours
  runArchiveCleanup();
  setInterval(runArchiveCleanup, 24 * 60 * 60 * 1000);

  // Check for due interest debits every 6 hours
  runInterestDebit();
  setInterval(runInterestDebit, 6 * 60 * 60 * 1000);

  const server = app.listen(PORT, () => {
    logger.banner(PORT);
    logger.success(`Server is live on port ${PORT}`);
    logger.info('Press Ctrl+C to stop\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${PORT} is already in use`);
    } else {
      logger.error('Server error', err.message);
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    logger.warn(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer().catch((err) => {
  logger.error('Failed to start server', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason?.message || reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err.message);
  process.exit(1);
});
