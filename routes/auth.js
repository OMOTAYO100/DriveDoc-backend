const express = require("express");
const { signup, login, getMe, oauthGoogle, oauthFacebook } = require("../controllers/authControllers");
const { protect } = require("../middleware/auth");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", protect, getMe);
router.post("/oauth/google", oauthGoogle);
router.post("/oauth/facebook", oauthFacebook);

module.exports = router;
