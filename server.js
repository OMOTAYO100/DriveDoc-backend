const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const connectDB = require("./config/db");
const webpush = require("web-push");
const { protect } = require("./middleware/auth");
const User = require("./models/user");
const Document = require("./models/Documents");

// Load env vars
dotenv.config();

// Connect to database
connectDB();

// Route files
const authRoutes = require("./routes/auth");
const documentRoutes = require("./routes/documents");

const app = express();

// Trust proxy for Render (required for express-rate-limit)
app.set("trust proxy", 1);

// 1. Enable CORS first (to handle preflights correctly)
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://driivedoc.netlify.app",
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
      // Allow requests with no origin (like mobile apps)
      if (!origin) return callback(null, true);
      
      const sanitizedOrigin = origin.replace(/\/$/, "");
      const isAllowed = allowedOrigins.some(o => o.replace(/\/$/, "") === sanitizedOrigin);
      
      if (isAllowed || process.env.NODE_ENV === "development") {
        callback(null, true);
      } else {
        console.error(`CORS BLOCKED: Origin "${origin}" is not in whitelist:`, allowedOrigins);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// 2. Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" }, // More permissive for Google/FB popups
  })
);

// 3. Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting
app.use("/api/", generalLimiter);

// 4. Other Middlewares
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Mount routers
app.use("/api/auth", authRoutes);
// Apply strict rate limiting to login/signup routes
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/documents", documentRoutes);
app.use("/api/bookings", require("./routes/bookings"));

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

app.get("/api/notifications/public-key", (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/api/notifications/subscribe", protect, async (req, res) => {
  try {
    const sub = req.body;
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": { $ne: sub.endpoint } },
      {
        $addToSet: {
          pushSubscriptions: {
            endpoint: sub.endpoint,
            keys: sub.keys,
            enabled: true,
          },
        },
      }
    );
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": sub.endpoint },
      {
        $set: {
          "pushSubscriptions.$.keys": sub.keys,
          "pushSubscriptions.$.enabled": true,
        },
      }
    );
    res.status(201).json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

app.post("/api/notifications/opt-out", protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": endpoint },
      { $set: { "pushSubscriptions.$.enabled": false } }
    );
    res.json({ success: true });
  } catch (_) {
    res.status(500).json({ success: false });
  }
});

app.post("/api/notifications/opt-in", protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await User.updateOne(
      { _id: req.user.id, "pushSubscriptions.endpoint": endpoint },
      { $set: { "pushSubscriptions.$.enabled": true } }
    );
    res.json({ success: true });
  } catch (_) {
    res.status(500).json({ success: false });
  }
});

app.post("/api/notifications/unsubscribe", protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { pushSubscriptions: { endpoint } } }
    );
    res.json({ success: true });
  } catch (_) {
    res.status(500).json({ success: false });
  }
});

const notifyExpiredDocuments = async () => {
  try {
    const now = new Date();
    const expiredDocs = await Document.find({ expiryDate: { $lte: now } });
    const soonDays = parseInt(process.env.EXPIRY_SOON_DAYS || "30", 10);
    const soonThreshold = new Date(Date.now() + soonDays * 24 * 60 * 60 * 1000);
    const expiringSoonDocs = await Document.find({
      expiryDate: { $gt: now, $lte: soonThreshold },
    });
    const usersMap = {};
    for (const doc of expiredDocs) {
      const uid = String(doc.user);
      if (!usersMap[uid]) {
        const u = await User.findById(uid);
        usersMap[uid] = u ? u.pushSubscriptions.filter((s) => s.enabled) : [];
      }
      for (const sub of usersMap[uid]) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: "Document expired",
              body: `${doc.type} (${doc.number}) has expired`,
            })
          );
        } catch (_) {}
      }
    }
    for (const doc of expiringSoonDocs) {
      const uid = String(doc.user);
      if (!usersMap[uid]) {
        const u = await User.findById(uid);
        usersMap[uid] = u ? u.pushSubscriptions.filter((s) => s.enabled) : [];
      }
      for (const sub of usersMap[uid]) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({
              title: "Document expiring soon",
              body: `${doc.type} (${doc.number}) expires on ${new Date(
                doc.expiryDate
              ).toLocaleDateString()}`,
            })
          );
        } catch (_) {}
      }
    }
  } catch (_) {}
};

const intervalMs =
  process.env.NODE_ENV === "development" ? 60 * 1000 : 60 * 60 * 1000;
setInterval(notifyExpiredDocuments, intervalMs);
notifyExpiredDocuments();

// Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "DriveDoc API is running",
  });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err, promise) => {
  console.log(`Error: ${err.message}`);
  server.close(() => process.exit(1));
});
