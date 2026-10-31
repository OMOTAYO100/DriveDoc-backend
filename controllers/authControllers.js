const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/user');
const Document = require('../models/Documents');
const { sendEmail, passwordResetEmail } = require('../utils/mailer');

const TERMS_VERSION = process.env.TERMS_VERSION || '2026-10-07';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const publicUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  country: user.country,
  authProvider: user.authProvider,
  profileComplete: user.profileComplete,
  emailReminders: user.emailReminders !== false
});

// Helper function to send token response with cookie
const sendTokenResponse = (user, statusCode, req, res, message = 'Success') => {
  const token = user.getSignedJwtToken();

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Use 'none' for cross-site in prod
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      message,
      token, // Still send in body for backward compatibility
      user: publicUser(user),
    });
};

// @desc    Register user
// @route   POST /api/auth/signup
// @access  Public
exports.signup = async (req, res) => {
  try {
    const { fullName, email, phone, country, password, termsAccepted } = req.body;

    if (!termsAccepted) {
      return res.status(400).json({
        success: false,
        message: 'Please accept the Terms of Service and Privacy Policy to continue'
      });
    }

    // Check if user exists
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    // Validate password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password || '')) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least 8 characters, including uppercase, lowercase, and number'
      });
    }

    // Create user
    const user = await User.create({
      fullName,
      email,
      phone,
      country,
      password,
      authProvider: 'local',
      profileComplete: true,
      termsAcceptedAt: new Date(),
      termsVersion: TERMS_VERSION
    });

    // Send token response with cookie
    sendTokenResponse(user, 201, req, res, 'Account created successfully');
  } catch (error) {
    console.error('Signup error:', error);
    // Surface mongoose validation messages, which are safe and useful, but
    // never leak an arbitrary error string to the client.
    if (error.name === 'ValidationError') {
      const first = Object.values(error.errors)[0];
      return res.status(400).json({ success: false, message: first.message });
    }
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Check for user (include password)
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Send token response with cookie
    sendTokenResponse(user, 200, req, res, 'Login successful');
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// @desc    Log out — clear the auth cookie
// @route   POST /api/auth/logout
// @access  Public
exports.logout = async (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
  res.status(200).json({ success: true, message: 'Logged out' });
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    // `protect` already loaded and verified the user.
    res.status(200).json({
      success: true,
      user: publicUser(req.user)
    });
  } catch (error) {
    console.error('getMe error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// @desc    Update own profile (name, phone, country)
// @route   PUT /api/auth/me
// @access  Private
exports.updateMe = async (req, res) => {
  try {
    const { fullName, phone, country, emailReminders } = req.body;
    const user = req.user;

    if (typeof fullName === 'string' && fullName.trim()) user.fullName = fullName.trim();
    if (typeof phone === 'string' && phone.trim()) user.phone = phone.trim();
    if (typeof country === 'string' && country.trim()) user.country = country.trim();
    if (typeof emailReminders === 'boolean') user.emailReminders = emailReminders;

    // A profile counts as complete once phone and country are real values
    // rather than the placeholders an OAuth sign-up starts with.
    const placeholder = (v) => !v || v === 'N/A' || v === 'Unknown';
    user.profileComplete = !placeholder(user.phone) && !placeholder(user.country);

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated',
      user: publicUser(user)
    });
  } catch (error) {
    console.error('updateMe error:', error);
    if (error.name === 'ValidationError') {
      const first = Object.values(error.errors)[0];
      return res.status(400).json({ success: false, message: first.message });
    }
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};

// @desc    Permanently delete own account and all associated data
// @route   DELETE /api/auth/me
// @access  Private
exports.deleteMe = async (req, res) => {
  try {
    const userId = req.user._id;

    // Remove everything that belongs to this user before the user itself, so a
    // failure part-way through never leaves orphaned records with no owner.
    await Document.deleteMany({ user: userId });
    await User.deleteOne({ _id: userId });

    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    });

    res.status(200).json({
      success: true,
      message: 'Your account and all associated data have been deleted'
    });
  } catch (error) {
    console.error('deleteMe error:', error);
    res.status(500).json({ success: false, message: 'Could not delete account. Please try again.' });
  }
};

// @desc    Export everything we hold about the current user
// @route   GET /api/auth/me/export
// @access  Private
exports.exportMe = async (req, res) => {
  try {
    const userId = req.user._id;
    const documents = await Document.find({ user: userId }).lean();

    res.status(200).json({
      success: true,
      exportedAt: new Date(),
      account: {
        fullName: req.user.fullName,
        email: req.user.email,
        phone: req.user.phone,
        country: req.user.country,
        authProvider: req.user.authProvider,
        termsAcceptedAt: req.user.termsAcceptedAt,
        termsVersion: req.user.termsVersion,
        createdAt: req.user.createdAt,
        pushSubscriptionCount: req.user.pushSubscriptions.length
      },
      documents
    });
  } catch (error) {
    console.error('exportMe error:', error);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};

// @desc    Request a password reset link
// @route   POST /api/auth/forgot-password
// @access  Public
exports.forgotPassword = async (req, res) => {
  // Always answer the same way. Anything that varies by whether the address
  // exists turns this endpoint into an account-enumeration oracle.
  const genericResponse = () =>
    res.status(200).json({
      success: true,
      message: 'If an account exists for that email, a reset link is on its way.'
    });

  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide your email address' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return genericResponse();

    // Google accounts have no password of their own to reset.
    if (user.authProvider === 'google') return genericResponse();

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });

    const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
    const resetUrl = `${clientUrl}/reset-password?token=${resetToken}`;

    const { subject, html, text } = passwordResetEmail(user.fullName, resetUrl);
    await sendEmail({ to: user.email, subject, html, text });

    return genericResponse();
  } catch (error) {
    console.error('forgotPassword error:', error);
    // Still generic — a 500 here would also leak that the address resolved.
    return genericResponse();
  }
};

// @desc    Set a new password using a reset token
// @route   POST /api/auth/reset-password
// @access  Public
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide the reset token and your new password'
      });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must contain at least 8 characters, including uppercase, lowercase, and number'
      });
    }

    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashed,
      resetPasswordExpire: { $gt: Date.now() }
    }).select('+password +resetPasswordToken +resetPasswordExpire');

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'That reset link is invalid or has expired. Please request a new one.'
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    // Any push subscription stays valid; only the password changes.
    await user.save();

    sendTokenResponse(user, 200, req, res, 'Password updated. You are signed in.');
  } catch (error) {
    console.error('resetPassword error:', error);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
};

// @desc    OAuth with a Google ID token (credential)
// @route   POST /api/auth/oauth/google
// @access  Public
exports.oauthGoogle = async (req, res) => {
  try {
    // A *credential* (ID token), not an access token. An access token proves
    // only that someone holds a Google token — not that it was issued to us,
    // so it would let a token from any other Google app sign in here.
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ success: false, message: 'Missing Google credential' });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.error('GOOGLE_CLIENT_ID is not configured — refusing Google sign-in.');
      return res.status(500).json({
        success: false,
        message: 'Google sign-in is not configured on this server.'
      });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } catch (verifyError) {
      console.warn('Google ID token verification failed:', verifyError.message);
      return res.status(401).json({
        success: false,
        message: 'Could not verify that Google sign-in. Please try again.'
      });
    }

    if (!payload?.email) {
      return res.status(401).json({ success: false, message: 'Google did not return an email address.' });
    }

    if (!payload.email_verified) {
      return res.status(401).json({
        success: false,
        message: 'That Google account has an unverified email address.'
      });
    }

    const email = payload.email.toLowerCase();
    const fullName = payload.name || payload.given_name || 'Google User';

    let user = await User.findOne({ email });
    if (!user) {
      console.log(`Creating new Google user: ${email}`);
      // A password this user will never use, so the field stays required and
      // bcrypt has something to hash. Reset is blocked for google accounts.
      const randomPass = crypto.randomBytes(24).toString('hex') + 'Aa1';
      user = await User.create({
        fullName,
        email,
        phone: 'N/A',
        country: 'Unknown',
        password: randomPass,
        authProvider: 'google',
        profileComplete: false,
        // Continuing through the Google button is the point of consent here;
        // the button sits directly under the same terms links.
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION
      });
    }

    sendTokenResponse(user, 200, req, res, 'Login successful');
  } catch (error) {
    console.error('SERVER OAUTH ERROR (Google):', error);
    res.status(500).json({
      success: false,
      message: 'Server error during Google authentication.'
    });
  }
};
