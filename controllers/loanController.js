const Loan        = require('../models/Loan');
const Account     = require('../models/Account');
const Client      = require('../models/Client');
const Transaction = require('../models/Transaction');
const logActivity = require('../utils/logActivity');
const { sendSms } = require('../utils/smsService');

const FREQ_MONTHS = { monthly: 1, quarterly: 3, annually: 12 };

const addMonths = (date, n) => {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
};

const nextInterestDate = (from, frequency) =>
  addMonths(from, FREQ_MONTHS[frequency] || 1);

/* ── GET: loan application form ──────────────── */
const newLoanForm = async (req, res) => {
  try {
    const client = await Client.findById(req.params.clientId).lean();
    if (!client) return res.status(404).render('login', { error: 'Client not found.' });

    const account = await Account.findOne({
      _id: req.params.accountId,
      client: client._id,
      accountType: 'loan',
    }).lean();
    if (!account) return res.status(404).render('login', { error: 'Loan account not found.' });

    const activeLoan = await Loan.findOne({ account: account._id, status: 'active' }).lean();

    res.render('loan-form', {
      user: req.session.user, client, account, activeLoan,
      loan: {}, errors: [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* ── POST: create loan ───────────────────────── */
const createLoan = async (req, res) => {
  let client, account;
  try {
    [client, account] = await Promise.all([
      Client.findById(req.params.clientId),
      Account.findOne({ _id: req.params.accountId, accountType: 'loan' }),
    ]);

    if (!client) return res.status(404).render('login', { error: 'Client not found.' });
    if (!account || String(account.client) !== String(client._id)) {
      return res.status(404).render('login', { error: 'Loan account not found.' });
    }

    const errors = [];
    const principal         = parseFloat(req.body.principal);
    const initialRate       = parseFloat(req.body.initialRate);
    const subsequentRate    = parseFloat(req.body.subsequentRate);
    const amortization      = parseInt(req.body.amortization, 10);
    const interestFrequency = req.body.interestFrequency;

    if (isNaN(principal)       || principal      <= 0) errors.push('Principal amount must be a positive number.');
    if (isNaN(initialRate)     || initialRate     < 0) errors.push('Initial interest rate must be 0 or greater.');
    if (isNaN(subsequentRate)  || subsequentRate  < 0) errors.push('Subsequent interest rate must be 0 or greater.');
    if (isNaN(amortization)    || amortization    < 1) errors.push('Amortization must be at least 1 month.');
    if (!['monthly', 'quarterly', 'annually'].includes(interestFrequency)) errors.push('Interest frequency is required.');

    if (!errors.length) {
      const existing = await Loan.findOne({ account: account._id, status: 'active' }).lean();
      if (existing) errors.push('This loan account already has an active loan. Close it before applying for a new one.');
    }

    if (errors.length) {
      const activeLoan = await Loan.findOne({ account: account._id, status: 'active' }).lean();
      return res.status(422).render('loan-form', {
        user: req.session.user, client: client.toObject(), account: account.toObject(),
        activeLoan, loan: req.body, errors,
      });
    }

    const startDate = new Date();
    const dueDate   = nextInterestDate(startDate, interestFrequency);

    await Loan.create({
      client:            client._id,
      account:           account._id,
      principal,
      initialRate,
      subsequentRate,
      amortization,
      interestFrequency,
      periodsCharged:    0,
      startDate,
      nextInterestDate:  dueDate,
      status:            'active',
      createdBy:         req.session.user.id,
    });

    // Credit principal to the loan account (disbursement)
    const newBalance = parseFloat((account.balance + principal).toFixed(2));
    await Transaction.create({
      client:       client._id,
      account:      account._id,
      type:         'credit',
      amount:       principal,
      description:  `Loan disbursement — ${amortization} month${amortization !== 1 ? 's' : ''}, ${initialRate}% first period then ${subsequentRate}% (${interestFrequency})`,
      category:     'loan',
      balanceAfter: newBalance,
      status:       'completed',
      date:         startDate,
    });
    account.balance = newBalance;
    await account.save();

    await logActivity(
      req, 'LOAN_CREATE', 'client',
      `Loan of ₵${principal.toFixed(2)} disbursed for ${client.name} — ${amortization} months, ${initialRate}%→${subsequentRate}% (${interestFrequency})`,
      { principal, initialRate, subsequentRate, amortization, interestFrequency },
      client._id,
    );
    sendSms(client.phone, `Dear ${client.name}, a loan of ₵${principal.toFixed(2)} has been disbursed to your account. New balance: ₵${newBalance.toFixed(2)}. - Siicasem`);

    req.session.flash = {
      type:    'success',
      message: `Loan of ₵${principal.toLocaleString('en-US', { minimumFractionDigits: 2 })} disbursed. First interest debit: ${initialRate}%. All subsequent debits: ${subsequentRate}%. Starts ${dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
    };
    res.redirect(303, `/clients/${client._id}`);
  } catch (err) {
    const activeLoan = account ? await Loan.findOne({ account: account._id, status: 'active' }).lean() : null;
    res.status(500).render('loan-form', {
      user: req.session.user, client: client?.toObject?.() || {},
      account: account?.toObject?.() || {}, activeLoan,
      loan: req.body, errors: [err.message],
    });
  }
};

/* ── POST: close a loan ──────────────────────── */
const closeLoan = async (req, res) => {
  try {
    const [client, account] = await Promise.all([
      Client.findById(req.params.clientId),
      Account.findOne({ _id: req.params.accountId, accountType: 'loan' }),
    ]);

    if (!client || !account || String(account.client) !== String(client._id)) {
      req.session.flash = { type: 'error', message: 'Loan account not found.' };
      return res.redirect(303, `/clients/${req.params.clientId}`);
    }

    const loan = await Loan.findOne({ account: account._id, status: 'active' });
    if (!loan) {
      req.session.flash = { type: 'error', message: 'No active loan to close.' };
      return res.redirect(303, `/clients/${client._id}/accounts/${account._id}/loans`);
    }

    if (account.balance !== 0) {
      req.session.flash = {
        type:    'error',
        message: `Loan cannot be closed — outstanding balance is ₵${Number(account.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}. Balance must be exactly ₵0.00.`,
      };
      return res.redirect(303, `/clients/${client._id}/accounts/${account._id}/loans`);
    }

    loan.status = 'completed';
    await loan.save();

    await logActivity(
      req, 'LOAN_CLOSE', 'client',
      `Loan of ₵${loan.principal.toFixed(2)} closed for ${client.name}`,
      { principal: loan.principal, periodsCharged: loan.periodsCharged },
      client._id,
    );

    req.session.flash = {
      type:    'success',
      message: `Loan of ₵${loan.principal.toLocaleString('en-US', { minimumFractionDigits: 2 })} successfully closed.`,
    };
    res.redirect(303, `/clients/${client._id}/accounts/${account._id}/loans`);
  } catch (err) {
    req.session.flash = { type: 'error', message: err.message };
    res.redirect(303, `/clients/${req.params.clientId}/accounts/${req.params.accountId}/loans`);
  }
};

/* ── GET: loan detail page ───────────────────── */
const viewLoan = async (req, res) => {
  try {
    const client = await Client.findById(req.params.clientId).lean();
    if (!client) return res.status(404).render('login', { error: 'Client not found.' });

    const account = await Account.findOne({
      _id: req.params.accountId,
      client: client._id,
      accountType: 'loan',
    }).lean();
    if (!account) return res.status(404).render('login', { error: 'Loan account not found.' });

    const [activeLoan, allLoans, interestTxns] = await Promise.all([
      Loan.findOne({ account: account._id, status: 'active' }).lean(),
      Loan.find({ account: account._id }).sort({ createdAt: -1 }).lean(),
      Transaction.find({ account: account._id, category: 'interest' }).sort({ date: -1 }).lean(),
    ]);

    const totalInterestCharged = interestTxns.reduce((s, t) => s + t.amount, 0);

    res.render('loan-detail', {
      user: req.session.user, client, account, activeLoan,
      allLoans, interestTxns, totalInterestCharged,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { newLoanForm, createLoan, closeLoan, viewLoan };
