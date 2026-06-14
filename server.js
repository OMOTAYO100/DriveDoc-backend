const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const path = require("path");
const webpush = require("web-push");
const connectDB = require("./config/db");
const { protect } = require("./middleware/auth");
const User = require("./models/user");
const Document = require("./models/Documents");

// Load env vars
dotenv.config();

console.log("🚀 DriveDoc Backend starting...");
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

// Connect to database
console.log("📡 Connecting to MongoDB...");
connectDB().then(() => {
    console.log("✅ MongoDB Connection logic initialized");
}).catch(err => {
    console.error("❌ MongoDB Connection Error:", err.message);
});

// Route files
const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/documents");
const bookingRoutes = require("./routes/bookings");

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
      const isAllowed = allowedOrigins.some(o => o.replace(/\/$/, "") === sanitizedOrigin);
      if (isAllowed || process.env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
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
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// 3. Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", generalLimiter);

// 4. Notifications Configuration
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  console.log("✉️  Configuring Web Push...");
  webpush.setVapidDetails(
    "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn("⚠️  VAPID keys missing. Push notifications will not work.");
}

// 5. API Routes
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/bookings", bookingRoutes);

app.get("/api/notifications/public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/api/notifications/subscribe", protect, async (req, res) => {
  try {
    const sub = req.body;
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": { $ne: sub.endpoint } },
      { $addToSet: { pushSubscriptions: { endpoint: sub.endpoint, keys: sub.keys, enabled: true } } }
    );
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": sub.endpoint },
      { $set: { "pushSubscriptions.$.keys": sub.keys, "pushSubscriptions.$.enabled": true } }
    );
    res.status(201).json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// Other notification routes...
app.post("/api/notifications/opt-out", protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": endpoint },
      { $set: { "pushSubscriptions.$.enabled": false } }
    );
    res.json({ success: true });
  } catch (_) { res.status(500).json({ success: false }); }
});

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, message: "DriveDoc API is running", timestamp: new Date() });
});

// 6. Static Asset Serving (Safer Implementation)
if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "../my-project/dist");
  const fs = require('fs');
  
  if (fs.existsSync(distPath)) {
    console.log(`📂 Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (!req.url.startsWith("/api")) {
        res.sendFile(path.join(distPath, "index.html"));
      }
    });
  } else {
    console.warn(`⚠️  Static folder not found at ${distPath}. Skipping static serve.`);
  }
}

// 7. Start Server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server is LIVE on port ${PORT}`);
});

// Expiry Check Interval
const notifyExpiredDocuments = async () => { /* ... existing logic ... */ };
const intervalMs = process.env.NODE_ENV === "development" ? 60 * 1000 : 60 * 60 * 1000;
// We'll keep the logic but for brevity I'll assume it's there or just simplify for the fix.
// Actually I should keep the full logic to avoid deleting user code.

// ... Full notification logic restored below ...
const fullNotifyExpired = async () => {
  try {
    const now = new Date();
    const documents = await Document.find({});
    const usersMap = {};

    for (const doc of documents) {
      const expiry = new Date(doc.expiryDate);
      const diffMs = expiry - now;
      const daysUntilExpiry = diffMs / (1000 * 60 * 60 * 24);

      let shouldNotify = false;
      let notificationTitle = "";
      let notificationBody = "";
      let notificationTag = `expiry-${doc._id}`;
      let notificationType = ""; // 'monthBefore', 'daily', 'expired'

      const expiryDateStr = expiry.toLocaleDateString(undefined, { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

      if (daysUntilExpiry < 0) {
        // Document has expired
        if (!doc.notifications || !doc.notifications.expiredSent) {
          shouldNotify = true;
          notificationType = "expired";
          notificationTitle = "Document Expired";
          notificationBody = `Your ${doc.type} (No. ${doc.number}) expired on ${expiryDateStr}.`;
        }
      } else if (daysUntilExpiry <= 7) {
        // Daily countdown: notify every day starting 7 days prior up to expiration
        const todayStr = now.toDateString();
        const lastDailySentStr = doc.notifications?.lastDailySentAt 
          ? new Date(doc.notifications.lastDailySentAt).toDateString() 
          : "";

        if (todayStr !== lastDailySentStr) {
          shouldNotify = true;
          notificationType = "daily";
          const daysRound = Math.ceil(daysUntilExpiry);
          notificationTitle = `Expiring Soon: ${doc.type}`;
          notificationBody = `Your ${doc.type} (No. ${doc.number}) expires in ${daysRound} day${daysRound !== 1 ? 's' : ''} on ${expiryDateStr}.`;
        }
      } else if (daysUntilExpiry <= 30 && daysUntilExpiry > 7) {
        // 1 month before warning
        if (!doc.notifications || !doc.notifications.monthBeforeSent) {
          shouldNotify = true;
          notificationType = "monthBefore";
          notificationTitle = `Expiring in 1 Month: ${doc.type}`;
          notificationBody = `Your ${doc.type} (No. ${doc.number}) will expire in 30 days on ${expiryDateStr}.`;
        }
      }

      if (shouldNotify) {
        const uid = String(doc.user);
        if (!usersMap[uid]) {
          const u = await User.findById(uid);
          usersMap[uid] = u ? u.pushSubscriptions.filter((s) => s.enabled) : [];
        }

        const subscriptions = usersMap[uid];
        for (const sub of subscriptions) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: sub.keys },
              JSON.stringify({
                title: notificationTitle,
                options: {
                  body: notificationBody,
                  tag: notificationTag,
                  icon: "/icons/icon-192x192.png",
                  badge: "/icons/badge-72x72.png",
                  vibrate: [200, 100, 200],
                  renotify: true,
                  requireInteraction: true,
                  data: {
                    url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/documents`
                  }
                }
              })
            );
          } catch (err) {
            console.error(`Error sending push notification: ${err.message}`);
          }
        }

        // Initialize notifications object if not exists
        if (!doc.notifications) {
          doc.notifications = {
            monthBeforeSent: false,
            lastDailySentAt: null,
            expiredSent: false
          };
        }

        // Update database flags
        if (notificationType === "expired") {
          doc.notifications.expiredSent = true;
        } else if (notificationType === "daily") {
          doc.notifications.lastDailySentAt = now;
        } else if (notificationType === "monthBefore") {
          doc.notifications.monthBeforeSent = true;
        }

        await doc.save();
      }
    }
  } catch (error) {
    console.error("Error running fullNotifyExpired:", error);
  }
};
setInterval(fullNotifyExpired, intervalMs);

// Handle unhandled promise rejections
process.on("unhandledRejection", (err, promise) => {
  console.log(`❌ Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});
