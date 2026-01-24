const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  country: {
    type: String,
    required: [true, 'Please provide document country']
  },
  type: {
    type: String,
    required: [true, 'Please provide document type']
  },
  number: {
    type: String,
    required: [true, 'Please provide document number']
  },
  issueDate: {
    type: Date
  },
  expiryDate: {
    type: Date,
    required: [true, 'Please provide expiry date']
  },
  status: {
    type: String,
    enum: ['valid', 'expiring', 'expired'],
    default: 'valid'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Calculate status based on expiry date
documentSchema.pre('save', function(next) {
  const today = new Date();
  const expiry = new Date(this.expiryDate);
  const daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    this.status = 'expired';
  } else if (daysUntilExpiry <= 30) {
    this.status = 'expiring';
  } else {
    this.status = 'valid';
  }

  next();
});

module.exports = mongoose.model('Document', documentSchema);