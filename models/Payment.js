const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  document: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true
  },
  type: {
      type: String, // e.g., 'renewal'
      default: 'renewal'
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'NGN'
  },
  paystackReference: {
    type: String,
    required: true
  },
  paystackTransactionId: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },
  date: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Payment', paymentSchema);
