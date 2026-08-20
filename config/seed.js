const User        = require('../models/User');
const Client      = require('../models/Client');
const Account     = require('../models/Account');
const Transaction = require('../models/Transaction');
const Branch      = require('../models/Branch');
const logger      = require('./logger');

/* ── Transaction generator ───────────────────── */
let _refSeq = 0;
const makeRef = (date) => {
  const ds = new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
  const n  = (++_refSeq).toString(36).padStart(4, '0').toUpperCase();
  return `TXN-${ds}-${n}`;
};

const CREDITS = [
  { description: 'Salary Deposit',          category: 'deposit',    min: 2200, max: 4800 },
  { description: 'Wire Transfer Received',   category: 'transfer',   min: 500,  max: 3000 },
  { description: 'Cash Deposit',             category: 'deposit',    min: 100,  max: 1000 },
  { description: 'Interest Credit',          category: 'interest',   min: 4,    max: 55   },
  { description: 'Refund Received',          category: 'deposit',    min: 25,   max: 450  },
  { description: 'Dividend Credit',          category: 'interest',   min: 30,   max: 200  },
];

const DEBITS = [
  { description: 'ATM Withdrawal',           category: 'withdrawal', min: 100,  max: 500  },
  { description: 'Bill Payment — Electricity', category: 'payment',  min: 75,   max: 180  },
  { description: 'Bill Payment — Internet',   category: 'payment',   min: 45,   max: 90   },
  { description: 'Bill Payment — Insurance',  category: 'payment',   min: 90,   max: 280  },
  { description: 'Grocery Store',             category: 'payment',   min: 55,   max: 230  },
  { description: 'Online Purchase',           category: 'payment',   min: 20,   max: 380  },
  { description: 'Transfer Out',              category: 'transfer',  min: 200,  max: 1400 },
  { description: 'Monthly Service Fee',       category: 'fee',       min: 5,    max: 22   },
  { description: 'POS Purchase',              category: 'payment',   min: 15,   max: 200  },
  { description: 'Subscription Charge',       category: 'payment',   min: 10,   max: 50   },
];

const pick  = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round = (n, step = 5) => Math.round(n / step) * step;

const generateStaffId = async () => {
  for (let i = 0; i < 20; i++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    if (!await User.exists({ staffId: id })) return id;
  }
  throw new Error('Could not generate a unique staff ID.');
};

function makeTransactions(clientId, accountId, targetBalance) {
  const now  = new Date();
  const N    = 18 + Math.floor(Math.random() * 10); // 18–27 transactions
  let balance = targetBalance * (0.38 + Math.random() * 0.2); // start 38–58 % of current

  const txns = [];

  for (let i = 0; i < N; i++) {
    // Spread evenly over 180 days, oldest first
    const date = new Date(now);
    date.setDate(date.getDate() - Math.round(((N - 1 - i) / (N - 1)) * 180));
    date.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));

    const type = Math.random() < 0.44 ? 'credit' : 'debit';
    let tpl, amount;

    if (type === 'credit') {
      tpl    = pick(CREDITS);
      amount = tpl.category === 'interest'
        ? Math.max(parseFloat((balance * 0.0022).toFixed(2)), 1)
        : round(tpl.min + Math.random() * (tpl.max - tpl.min));
      balance += amount;
    } else {
      tpl    = pick(DEBITS);
      const cap = Math.min(tpl.max, balance * 0.35);
      amount = tpl.category === 'fee'
        ? parseFloat((tpl.min + Math.random() * (tpl.max - tpl.min)).toFixed(2))
        : round(Math.max(tpl.min, Math.random() * cap));
      balance = Math.max(balance - amount, 0);
    }

    txns.push({
      client:       clientId,
      account:      accountId,
      type,
      amount:       parseFloat(amount.toFixed(2)),
      description:  tpl.description,
      category:     tpl.category,
      reference:    makeRef(date),
      balanceAfter: parseFloat(balance.toFixed(2)),
      status:       Math.random() > 0.05
        ? 'completed'
        : (Math.random() > 0.5 ? 'pending' : 'failed'),
      date,
    });
  }

  // Final correcting transaction to land on targetBalance — dated after every
  // other transaction so it's always the chronologically-last entry
  const diff = parseFloat((targetBalance - balance).toFixed(2));
  if (Math.abs(diff) >= 0.01) {
    const type = diff > 0 ? 'credit' : 'debit';
    const lastDate = txns.length ? txns[txns.length - 1].date.getTime() : now.getTime();
    const correctingDate = new Date(Math.max(lastDate, now.getTime()) + 60 * 1000);
    txns.push({
      client:       clientId,
      account:      accountId,
      type,
      amount:       Math.abs(diff),
      description:  type === 'credit' ? 'Salary Deposit' : 'Account Settlement',
      category:     type === 'credit' ? 'deposit' : 'payment',
      reference:    makeRef(correctingDate),
      balanceAfter: parseFloat(targetBalance.toFixed(2)),
      status:       'completed',
      date:         correctingDate,
    });
  }

  return txns;
}

/* accounts: [{ _id, client, targetBalance }] — inserts transaction history and
   leaves each account's `balance` matching the last transaction's balanceAfter */
async function seedTransactions(accounts) {
  const all = [];
  for (const a of accounts) all.push(...makeTransactions(a.client, a._id, a.targetBalance));
  await Transaction.insertMany(all);
  await Promise.all(accounts.map((a) => Account.updateOne({ _id: a._id }, { balance: a.targetBalance })));
  logger.success(`Seeded ${all.length} transactions across ${accounts.length} accounts`);
}

/* ── Main seed ───────────────────────────────── */
const seed = async () => {
  const userCount = await User.countDocuments();

  if (userCount === 0) {
    logger.info('No users found — seeding default accounts…');

    const staffIds = [];
    for (let i = 0; i < 3; i++) staffIds.push(await generateStaffId());

    const users = await User.create([
      { name: 'Super Admin', email: 'superadmin@siicasem.app', password: 'Admin@1234',  role: 'super_admin', staffId: staffIds[0] },
      { name: 'Jane Admin',  email: 'admin@siicasem.app',      password: 'Admin@1234',  role: 'admin',       staffId: staffIds[1] },
      { name: 'Tom Teller',  email: 'teller@siicasem.app',     password: 'Teller@1234', role: 'teller',      staffId: staffIds[2] },
    ]);

    const teller = users[2];

    let branch = await Branch.findOne();
    if (!branch) branch = await Branch.create({ name: 'Main Branch', code: '001' });

    const clientSpecs = [
      { name: 'Alice Johnson', email: 'alice@clients.com', phone: '0244123401', accountType: 'savings',  balance: 12500.00, status: 'active',    assignedTeller: teller._id },
      { name: 'Bob Smith',     email: 'bob@clients.com',   phone: '0244123402', accountType: 'checking', balance:  4300.50, status: 'active',    assignedTeller: teller._id },
      { name: 'Carol White',   email: 'carol@clients.com', phone: '0244123403', accountType: 'business', balance: 89750.00, status: 'active'                              },
      { name: 'David Brown',   email: 'david@clients.com', phone: '0244123404', accountType: 'savings',  balance:  2100.00, status: 'inactive'                            },
      { name: 'Eva Martinez',  email: 'eva@clients.com',   phone: '0244123405', accountType: 'checking', balance:  6800.25, status: 'active'                              },
      { name: 'Frank Lee',     email: 'frank@clients.com', phone: '0244123406', accountType: 'savings',  balance: 15000.00, status: 'active',    assignedTeller: teller._id },
    ];

    const accounts = [];
    for (const [i, spec] of clientSpecs.entries()) {
      const client = await Client.create({
        name: spec.name, email: spec.email, phone: spec.phone,
        status: spec.status, assignedTeller: spec.assignedTeller,
        homeBranch: branch._id, approvalStatus: 'approved',
      });
      const account = await Account.create({
        client: client._id,
        accountNumber: `${branch.code}${String(1001 + i)}`,
        accountType: spec.accountType,
        balance: 0,
        status: spec.status,
        approvalStatus: 'approved',
      });
      accounts.push({ _id: account._id, client: client._id, targetBalance: spec.balance });
    }

    await seedTransactions(accounts);

    logger.success('Seed complete');
    logger.info(`  ${staffIds[0]}  /  Admin@1234  (Super Admin — ${users[0].email})`);
    logger.info(`  ${staffIds[1]}  /  Admin@1234  (Admin — ${users[1].email})`);
    logger.info(`  ${staffIds[2]}  /  Teller@1234 (Teller — ${users[2].email})\n`);
  } else {
    // Patch: seed transactions for any account that doesn't have any yet
    const accountsWithoutTxns = await Account.aggregate([
      { $lookup: { from: 'transactions', localField: '_id', foreignField: 'account', as: 'txns' } },
      { $match: { txns: { $size: 0 } } },
      { $project: { client: 1, balance: 1 } },
    ]);
    if (accountsWithoutTxns.length) {
      logger.info(`Seeding transactions for ${accountsWithoutTxns.length} account(s) without any…`);
      await seedTransactions(accountsWithoutTxns.map((a) => ({ _id: a._id, client: a.client, targetBalance: a.balance || 0 })));
    }
  }
};

module.exports = seed;
