const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const webpush = require("web-push");

// Load env vars before anything reads process.env
dotenv.config();

const connectDB = require("./config/db");
const { protect } = require("./middleware/auth");
const User = require("./models/user");
const { runExpiryNotifications } = require("./jobs/notifyExpiring");
const { verifyUnsubscribeToken } = require("./utils/mailer");

console.log("🚀 DriveDoc Backend starting...");
console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

// Fail fast on configuration that would otherwise break at runtime in ways
// that are hard to trace back to a missing variable.
const REQUIRED_ENV = ["MONGODB_URI", "JWT_SECRET"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k] && !(k === "MONGODB_URI" && process.env.MONGO_URI));
if (missing.length) {
  console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
  console.warn("⚠️  JWT_SECRET is shorter than 32 characters. Use a longer random value.");
}

// Connect to database
console.log("📡 Connecting to MongoDB...");
connectDB();

// Route files
const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/documents");
const guidanceRoutes = require("./routes/guidance");
const schoolRoutes = require("./routes/schools");

const app = express();

// Trust proxy for Render (required for express-rate-limit)
app.set("trust proxy", 1);

// 1. Enable CORS
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://drivedoc.netlify.app",
  "https://drivedoc.org",
  "https://www.drivedoc.org",
  "https://drivedoc-backend.onrender.com",
];

if (process.env.CLIENT_URL) {
  const clientUrl = process.env.CLIENT_URL.replace(/\/$/, "");
  if (!allowedOrigins.includes(clientUrl)) {
    allowedOrigins.push(clientUrl);
  }
}

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      const sanitizedOrigin = origin.replace(/\/$/, "");
      const isAllowed = allowedOrigins.some((o) => o.replace(/\/$/, "") === sanitizedOrigin);
      if (isAllowed || process.env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        // Tagged so the error handler below can answer with a clean JSON 403
        // instead of Express's default HTML error page.
        const err = new Error("Not allowed by CORS");
        err.status = 403;
        err.expose = true;
        callback(err);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// 2. Security & Optimization
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(cookieParser());

// 3. Rate limiting
// Sized for a person using the app, not for a client polling in a loop. The
// tighter limiter on credential endpoints lives in routes/auth.js.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  // Must be JSON. A string `message` is sent as HTML, which the frontend
  // reports as "check backend server" rather than "slow down".
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message: "Too many requests. Please wait a moment and try again.",
    }),
});
app.use("/api/", generalLimiter);

// 4. Notifications Configuration
const pushEnabled = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (pushEnabled) {
  console.log("✉️  Configuring Web Push...");
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL || "support@drivedoc.org"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn("⚠️  VAPID keys missing. Push notifications will not work.");
}

// 5. API Routes
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/guidance", guidanceRoutes);
app.use("/api/schools", schoolRoutes);

app.get("/api/notifications/public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/api/notifications/subscribe", protect, async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys) {
      return res.status(400).json({ success: false, message: "Invalid push subscription" });
    }

    const existing = await User.findOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": endpoint },
      { "pushSubscriptions.$": 1 }
    );

    if (existing) {
      // Refresh the keys but leave `enabled` alone. Forcing it true here was
      // what made opting out revert on the next page load.
      await User.updateOne(
        { _id: req.user.id, "pushSubscriptions.endpoint": endpoint },
        { $set: { "pushSubscriptions.$.keys": keys } }
      );
      return res.status(200).json({
        success: true,
        enabled: existing.pushSubscriptions[0].enabled,
      });
    }

    await User.updateOne(
      { _id: req.user.id },
      { $push: { pushSubscriptions: { endpoint, keys, enabled: true } } }
    );
    res.status(201).json({ success: true, enabled: true });
  } catch (e) {
    console.error("subscribe error:", e);
    res.status(500).json({ success: false, message: "Could not save notification settings." });
  }
});

app.post("/api/notifications/opt-out", protect, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, message: "Missing subscription endpoint" });
    }
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": endpoint },
      { $set: { "pushSubscriptions.$.enabled": false } }
    );
    res.json({ success: true });
  } catch (e) {
    console.error("opt-out error:", e);
    res.status(500).json({ success: false, message: "Could not save notification settings." });
  }
});

app.post("/api/notifications/opt-in", protect, async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, message: "Missing subscription endpoint" });
    }
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": endpoint },
      { $set: { "pushSubscriptions.$.enabled": true } }
    );
    res.json({ success: true });
  } catch (e) {
    console.error("opt-in error:", e);
    res.status(500).json({ success: false, message: "Could not save notification settings." });
  }
});

// Email reminder preference, for the signed-in user.
app.put("/api/notifications/email", protect, async (req, res) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ success: false, message: "`enabled` must be true or false" });
    }
    await User.updateOne({ _id: req.user.id }, { $set: { emailReminders: enabled } });
    res.json({ success: true, emailReminders: enabled });
  } catch (e) {
    console.error("email preference error:", e);
    res.status(500).json({ success: false, message: "Could not save your reminder settings." });
  }
});

// One-click unsubscribe from reminder emails.
//
// This is the one endpoint under /api that deliberately answers with HTML: it
// is opened by a person in a browser from an email client, with no session and
// no JavaScript. Don't "fix" it to return JSON.
//
// It accepts GET (a clicked link) and POST (RFC 8058 one-click, which Gmail
// and Outlook call on the user's behalf).
const handleEmailUnsubscribe = async (req, res) => {
  const { u: userId, t: token } = req.method === "POST" ? { ...req.query, ...req.body } : req.query;

  const page = (title, message) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · DriveDoc</title></head>
<body style="margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
<div style="max-width:460px;margin:64px auto;background:#fff;border-radius:12px;padding:32px;text-align:center;color:#15191c">
  <div style="font-size:22px;font-weight:700;margin-bottom:20px">Drive<span style="color:#2563eb">Doc</span></div>
  <h1 style="font-size:19px;margin:0 0 10px">${title}</h1>
  <p style="font-size:15px;line-height:1.6;color:#4b5563;margin:0 0 24px">${message}</p>
  <a href="${(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "")}"
     style="display:inline-block;background:#2563eb;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Open DriveDoc</a>
</div></body></html>`;

  try {
    if (!userId || !token || !verifyUnsubscribeToken(userId, token)) {
      return res
        .status(400)
        .type("html")
        .send(page("That link didn't work", "It may have been altered or have expired. You can turn reminders off from your account settings instead."));
    }

    const result = await User.updateOne({ _id: userId }, { $set: { emailReminders: false } });
    if (!result.matchedCount) {
      return res
        .status(404)
        .type("html")
        .send(page("Account not found", "This account no longer exists, so no further emails will be sent."));
    }

    res
      .status(200)
      .type("html")
      .send(
        page(
          "Email reminders turned off",
          "You won't get any more expiry reminders by email. Push notifications, if you turned them on, are unaffected — and you can switch email back on any time from your account settings."
        )
      );
  } catch (e) {
    console.error("unsubscribe error:", e);
    res.status(500).type("html").send(page("Something went wrong", "Please try again, or turn reminders off from your account settings."));
  }
};

app.get("/api/notifications/email/unsubscribe", handleEmailUnsubscribe);
app.post("/api/notifications/email/unsubscribe", handleEmailUnsubscribe);

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "DriveDoc API is running",
    push: pushEnabled,
    timestamp: new Date(),
  });
});

// 6. Expiry sweep, triggered externally
// An in-process setInterval silently stops running whenever the instance
// sleeps, restarts or deploys, and double-sends if a second instance starts.
// An external scheduler (Render Cron, a scheduled GitHub Action, cron-job.org)
// hitting this hourly wakes a sleeping instance instead of skipping the hour.
// The job is idempotent within a calendar day, so a retry is harmless.
app.post("/api/jobs/notify-expiring", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: "CRON_SECRET is not configured on this server.",
    });
  }
  if (req.get("x-cron-secret") !== secret) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }

  try {
    const summary = await runExpiryNotifications();
    res.status(200).json({ success: true, ...summary });
  } catch (err) {
    res.status(500).json({ success: false, message: "Sweep failed" });
  }
});

// In development only, keep a short interval so the flow is observable without
// setting up a scheduler. Production relies on the endpoint above.
if (process.env.NODE_ENV === "development" && process.env.DISABLE_DEV_SWEEP !== "true") {
  console.log("⏱️  Dev mode: running the expiry sweep every 60s");
  setInterval(() => {
    runExpiryNotifications().catch((e) => console.error("Dev sweep error:", e.message));
  }, 60 * 1000);
}

// 7. Unmatched API routes — JSON, not Express's HTML 404
app.use("/api", (req, res) => {
  res.status(404).json({
    success: false,
    message: `No API route for ${req.method} ${req.originalUrl}`,
  });
});

// 8. Error handler. Must be last, and must have four arguments for Express to
// recognise it. Without this, a thrown error reaches the client as HTML and the
// frontend reports a backend outage regardless of the real cause.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error("Unhandled error:", err);
  }
  // `expose` marks a message as written for the user, whatever the status —
  // a 503 "we can't search right now" is more use than a generic apology.
  const safeToShow = err.expose === true || status < 500;
  res.status(status).json({
    success: false,
    message: safeToShow ? err.message : "Something went wrong on our end.",
  });
});

// 9. Start Server
// Only bind a port when this file is run directly. Requiring it — as the test
// suite does — hands back the configured app without listening or holding the
// process open.
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, () => {
    console.log(`✅ Server is LIVE on port ${PORT}`);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (err) => {
    console.error(`❌ Unhandled Rejection: ${err?.message || err}`);
    server.close(() => process.exit(1));
  });

  process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down.");
    server.close(() => process.exit(0));
  });
}

module.exports = app;
