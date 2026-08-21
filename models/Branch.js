const mongoose = require('mongoose');
const titleCase = require('../utils/titleCase');

const branchSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true, unique: true, set: titleCase },
  code:     { type: String, trim: true, uppercase: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Branch', branchSchema);
