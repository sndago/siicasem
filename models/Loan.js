const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  client:            { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  account:           { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  principal:         { type: Number, required: true, min: 0.01 },
  initialRate:       { type: Number, required: true, min: 0 },    // % charged for the first period
  subsequentRate:    { type: Number, required: true, min: 0 },    // % charged for all periods after the first
  amortization:      { type: Number, required: true, min: 1 },
  interestFrequency: { type: String, enum: ['monthly', 'quarterly', 'annually'], default: 'monthly' },
  periodsCharged:    { type: Number, default: 0 },                // how many interest debits have fired
  startDate:         { type: Date, default: Date.now },
  nextInterestDate:  { type: Date, required: true },
  status:            { type: String, enum: ['active', 'completed', 'defaulted'], default: 'active' },
  createdBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

loanSchema.index({ status: 1, nextInterestDate: 1 });
loanSchema.index({ account: 1, status: 1 });

module.exports = mongoose.model('Loan', loanSchema);
