const User = require('../models/user');
const https = require('https');
const crypto = require('crypto');

// Helper function to send token response with cookie
const sendTokenResponse = (user, statusCode, res, message = 'Success') => {
  const token = user.getSignedJwtToken();

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      message,
      token, // Still send in body for backward compatibility
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        country: user.country,
      },
    });
};

// @desc    Register user
// @route   POST /api/auth/signup
// @access  Public
exports.signup = async (req, res) => {
  try {
    const { fullName, email, phone, country, password } = req.body;

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
    if (!passwordRegex.test(password)) {
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
      password
    });

    // Send token response with cookie
    sendTokenResponse(user, 201, res, 'Account created successfully');
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message
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
    sendTokenResponse(user, 200, res, 'Login successful');
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message
    });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        country: user.country
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
};

// Helper: GET JSON via https without extra deps
const httpsGetJson = (url) =>
  new Promise((resolve, reject) => {
    https
      .get(url, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', (err) => reject(err));
  });

// @desc    OAuth with Google ID token
// @route   POST /api/auth/oauth/google
// @access  Public
exports.oauthGoogle = async (req, res) => {
  try {
    // We now expect accessToken
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ success: false, message: 'Missing accessToken' });
    }
    
    // Verify accessToken and get user info
    const userInfo = await httpsGetJson(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`
    );

    if (userInfo.error || !userInfo.email) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }

    const email = userInfo.email;
    const fullName = userInfo.name || userInfo.given_name || 'Google User';

    let user = await User.findOne({ email });
    if (!user) {
      const randomPass = crypto.randomBytes(16).toString('hex') + 'Aa1';
      user = await User.create({
        fullName,
        email,
        phone: 'N/A',
        country: 'Unknown',
        password: randomPass,
      });
    }
    
    // Send token response with cookie
    sendTokenResponse(user, 200, res, 'Login successful');
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message,
    });
  }
};

// @desc    OAuth with Facebook access token
// @route   POST /api/auth/oauth/facebook
// @access  Public
exports.oauthFacebook = async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ success: false, message: 'Missing accessToken' });
    }
    const profile = await httpsGetJson(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`
    );
    if (profile.error) {
      return res.status(401).json({ success: false, message: 'Invalid Facebook token' });
    }
    const email = profile.email;
    const fullName = profile.name || 'Facebook User';
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email not available from Facebook' });
    }
    let user = await User.findOne({ email });
    if (!user) {
      const randomPass = crypto.randomBytes(16).toString('hex') + 'Aa1';
      user = await User.create({
        fullName,
        email,
        phone: 'N/A',
        country: 'Unknown',
        password: randomPass,
      });
    }
    
    // Send token response with cookie
    sendTokenResponse(user, 200, res, 'Login successful');
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.',
      error: error.message,
    });
  }
};
