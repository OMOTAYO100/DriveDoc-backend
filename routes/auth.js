const express = require("express");
const rateLimit = require("express-rate-limit");
const { body } = require("express-validator");
const {
  signup,
  login,
  logout,
  getMe,
  updateMe,
  deleteMe,
  exportMe,
  forgotPassword,
  resetPassword,
  oauthGoogle,
} = require("../controllers/authControllers");
const { protect } = require("../middleware/auth");
const { validate } = require("../middleware/validate");

const router = express.Router();

// Credential-handling endpoints get a much tighter budget than the general API
// limiter — 300/15min is not brute-force protection.
//
// Each concern gets its OWN limiter instance. Sharing one instance means a
// burst of failed logins from an address also blocks signup and password reset
// from that address, which punishes everyone behind a shared or NAT IP for one
// person's typo.
const makeAuthLimiter = (max, message) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    // Don't spend the budget on requests that succeeded.
    skipSuccessfulRequests: true,
    handler: (req, res) => res.status(429).json({ success: false, message }),
  });

const loginLimiter = makeAuthLimiter(
  10,
  "Too many sign-in attempts. Please wait a few minutes and try again."
);
const signupLimiter = makeAuthLimiter(
  20,
  "Too many sign-up attempts from this network. Please wait a few minutes."
);
const resetLimiter = makeAuthLimiter(
  10,
  "Too many password reset attempts. Please wait a few minutes and try again."
);
const oauthLimiter = makeAuthLimiter(
  20,
  "Too many sign-in attempts. Please wait a few minutes and try again."
);

router.post(
  "/signup",
  signupLimiter,
  [
    body("fullName").trim().isLength({ min: 3 }).withMessage("Full name must be at least 3 characters"),
    body("email").isEmail().withMessage("Please provide a valid email").normalizeEmail(),
    body("phone").trim().notEmpty().withMessage("Phone number is required"),
    body("country").trim().notEmpty().withMessage("Country is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("termsAccepted").equals("true").withMessage("Please accept the Terms of Service and Privacy Policy"),
  ],
  validate,
  signup
);

router.post(
  "/login",
  loginLimiter,
  [
    body("email").isEmail().withMessage("Please provide a valid email").normalizeEmail(),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  validate,
  login
);

router.post("/logout", logout);

router.post(
  "/forgot-password",
  resetLimiter,
  [body("email").isEmail().withMessage("Please provide a valid email").normalizeEmail()],
  validate,
  forgotPassword
);

router.post(
  "/reset-password",
  resetLimiter,
  [
    body("token").notEmpty().withMessage("Reset token is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
  ],
  validate,
  resetPassword
);

router.post("/oauth/google", oauthLimiter, oauthGoogle);

router
  .route("/me")
  .get(protect, getMe)
  .put(protect, updateMe)
  .delete(protect, deleteMe);

router.get("/me/export", protect, exportMe);

module.exports = router;
