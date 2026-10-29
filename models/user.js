const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Please provide your full name'],
    trim: true,
    minlength: [3, 'Full name must be at least 3 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/,
      'Please provide a valid email'
    ]
  },
  phone: {
    type: String,
    required: [true, 'Please provide a phone number']
  },
  country: {
    type: String,
    required: [true, 'Please provide your country']
  },
  // 'local' users signed up with a password; 'google' users came through OAuth
  // and may not have completed their profile yet.
  authProvider: {
    type: String,
    enum: ['local', 'google'],
    default: 'local'
  },
  // True once the user has supplied a real phone number and country. OAuth
  // sign-ups start incomplete and are prompted to finish in the account panel.
  profileComplete: {
    type: Boolean,
    default: true
  },
  pushSubscriptions: [
    {
      endpoint: { type: String, required: true },
      keys: { type: Object, required: true },
      enabled: { type: Boolean, default: true }
    }
  ],
  // Email expiry reminders are on by default: being told before a document
  // expires is the service the user signed up for, and email is the only
  // channel that works without a browser permission or an installed PWA.
  // Every reminder carries a one-click unsubscribe link.
  emailReminders: {
    type: Boolean,
    default: true
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  // Hashed reset token. The plain token only ever exists in the email link.
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpire: {
    type: Date,
    select: false
  },
  // Evidence of consent. Recorded at signup so it can be shown later.
  termsAcceptedAt: {
    type: Date
  },
  termsVersion: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Encrypt password before saving.
// The early return matters: without it an unrelated save() (e.g. updating a
// push subscription) would fall through and re-hash the already-hashed value.
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Generate JWT token
userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// Match user password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Create a password reset token. Returns the plain token for the email link and
// stores only its hash, so a leaked database row can't be used to reset.
userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  this.resetPasswordExpire = Date.now() + 60 * 60 * 1000; // 1 hour

  return resetToken;
};

userSchema.statics.hashResetToken = function (plainToken) {
  return crypto.createHash('sha256').update(plainToken).digest('hex');
};

module.exports = mongoose.model('User', userSchema);
