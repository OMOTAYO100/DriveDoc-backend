const webpush = require('web-push');
const User = require('../models/user');
const Document = require('../models/Documents');
const { getGuidance } = require('../data/renewalGuidance');
const { sendEmail, expiryReminderEmail } = require('../utils/mailer');

const DAY_MS = 1000 * 60 * 60 * 24;

/** YYYY-MM-DD in UTC. Timezone-stable key for 'have we already sent today?'. */
const utcDayKey = (d) => d.toISOString().slice(0, 10);

const formatExpiry = (expiry) =>
  expiry.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });

/**
 * Decide whether a document needs a notification right now, and which one.
 *
 * Pure function of (document, now) — no database, no network — so the
 * branching can be tested directly. Returns null when nothing is due.
 */
const decideNotification = (doc, now = new Date()) => {
  const expiry = new Date(doc.expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;

  const daysUntilExpiry = (expiry - now) / DAY_MS;
  const notifications = doc.notifications || {};
  const expiryDateStr = formatExpiry(expiry);

  if (daysUntilExpiry < 0) {
    if (notifications.expiredSent) return null;
    return {
      type: 'expired',
      days: Math.floor(daysUntilExpiry),
      title: 'Document Expired',
      body: `Your ${doc.type} (No. ${doc.number}) expired on ${expiryDateStr}.`
    };
  }

  if (daysUntilExpiry <= 7) {
    // Daily countdown over the last week. Keyed on the UTC calendar day so
    // the job is safe to run more than once a day — and so the boundary does
    // not move with the server's timezone, which toDateString() would do.
    const todayStr = utcDayKey(now);
    const lastSentStr = notifications.lastDailySentAt
      ? utcDayKey(new Date(notifications.lastDailySentAt))
      : '';
    if (todayStr === lastSentStr) return null;

    const days = Math.ceil(daysUntilExpiry);
    return {
      type: 'daily',
      days,
      title: `Expiring Soon: ${doc.type}`,
      body: `Your ${doc.type} (No. ${doc.number}) expires in ${days} day${days !== 1 ? 's' : ''} on ${expiryDateStr}.`
    };
  }

  if (daysUntilExpiry <= 30) {
    if (notifications.monthBeforeSent) return null;
    // Use the real figure. Hardcoding "30 days" told a user 11 days out that
    // they had a month.
    const days = Math.ceil(daysUntilExpiry);
    return {
      type: 'monthBefore',
      days,
      title: `Expiring Soon: ${doc.type}`,
      body: `Your ${doc.type} (No. ${doc.number}) expires in ${days} days on ${expiryDateStr}.`
    };
  }

  return null;
};

const applyFlags = (doc, type, now) => {
  if (!doc.notifications) {
    doc.notifications = { monthBeforeSent: false, lastDailySentAt: null, expiredSent: false };
  }
  if (type === 'expired') doc.notifications.expiredSent = true;
  else if (type === 'daily') doc.notifications.lastDailySentAt = now;
  else if (type === 'monthBefore') doc.notifications.monthBeforeSent = true;
};

/**
 * Push one notification per document. Returns the endpoints the push service
 * told us are dead, so the caller can prune them.
 */
const sendPushes = async (subscriptions, decision, doc, clientUrl, summary) => {
  const stale = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({
          title: decision.title,
          options: {
            body: decision.body,
            tag: `expiry-${doc._id}`,
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            vibrate: [200, 100, 200],
            renotify: true,
            requireInteraction: true,
            // Deep link straight onto this document's renewal guidance.
                data: { url: `${clientUrl}/documents/${doc._id}` }
          }
        })
      );
      summary.pushed += 1;
    } catch (err) {
      summary.pushFailed += 1;
      // 404/410 means the browser threw the subscription away. Drop it so we
      // stop paying for it on every future run.
      if (err.statusCode === 404 || err.statusCode === 410) {
        stale.push(sub.endpoint);
      } else {
        console.error(`Push send failed (${err.statusCode || 'no status'}): ${err.message}`);
      }
    }
  }

  return stale;
};

/**
 * Sweep documents that are near or past expiry and tell their owners.
 *
 * Two channels, deliberately:
 *   • push  — one per document, so each gets its own tag and its own tap target
 *   • email — ONE per user covering everything due, so a person with four
 *             expiring documents gets one message, not four
 *
 * Email is the channel that actually reaches everyone: push needs a granted
 * permission and, on iOS, an installed PWA. A reminder product that only
 * reminds the subset of users who cleared both bars is not doing its job.
 *
 * Idempotent within a UTC day — the per-document flags gate both channels
 * together, so a retry re-sends neither.
 */
const runExpiryNotifications = async () => {
  const now = new Date();
  const summary = {
    examined: 0,
    due: 0,
    pushed: 0,
    pushFailed: 0,
    emailed: 0,
    emailFailed: 0,
    emailSkipped: 0
  };

  const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');

  // Only documents that could possibly be due: expiring within the next 30
  // days, or already expired but not yet told about. Replaces an unfiltered
  // find({}) that pulled the whole collection into memory every run.
  const horizon = new Date(now.getTime() + 31 * DAY_MS);
  const documents = await Document.find({
    $or: [
      { expiryDate: { $lte: horizon, $gte: new Date(now.getTime() - 365 * DAY_MS) } },
      { expiryDate: { $lt: now }, 'notifications.expiredSent': { $ne: true } }
    ]
  });

  summary.examined = documents.length;

  // Group everything due by owner, so each person gets a single email.
  const byUser = new Map();
  for (const doc of documents) {
    const decision = decideNotification(doc, now);
    if (!decision) continue;

    summary.due += 1;
    const uid = String(doc.user);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push({ doc, decision });
  }

  for (const [uid, entries] of byUser) {
    const user = await User.findById(uid).select('fullName email emailReminders pushSubscriptions');
    if (!user) {
      // Orphaned documents — the owner is gone. Flag them so we stop looking.
      for (const { doc, decision } of entries) {
        applyFlags(doc, decision.type, now);
        await doc.save();
      }
      continue;
    }

    // ---- push, one per document ----
    const enabledSubs = user.pushSubscriptions.filter((s) => s.enabled);
    const staleEndpoints = new Set();

    if (enabledSubs.length) {
      for (const { doc, decision } of entries) {
        const stale = await sendPushes(enabledSubs, decision, doc, clientUrl, summary);
        stale.forEach((e) => staleEndpoints.add(e));
      }
    }

    if (staleEndpoints.size) {
      await User.updateOne(
        { _id: uid },
        { $pull: { pushSubscriptions: { endpoint: { $in: [...staleEndpoints] } } } }
      );
    }

    // ---- email, one per user ----
    if (user.emailReminders && user.email) {
      const items = entries.map(({ doc, decision }) => ({
        document: doc,
        kind: decision.type === 'expired' ? 'expired' : 'upcoming',
        days: Math.abs(decision.days),
        expiryLabel: formatExpiry(new Date(doc.expiryDate)),
        guidance: getGuidance(doc.country, doc.type)
      }));

      // Most urgent first — an expired document should lead the email.
      items.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'expired' ? -1 : 1;
        return a.kind === 'expired' ? b.days - a.days : a.days - b.days;
      });

      const { subject, text, html, headers } = expiryReminderEmail(user, items, clientUrl);
      const result = await sendEmail({ to: user.email, subject, text, html, headers });

      if (result.delivered) summary.emailed += 1;
      else if (result.reason === 'no-api-key') summary.emailSkipped += 1;
      else summary.emailFailed += 1;
    } else {
      summary.emailSkipped += 1;
    }

    // ---- record, so neither channel repeats ----
    // Flags are set even when nothing could be delivered; otherwise a user who
    // turns a channel on later would receive a backlog all at once.
    for (const { doc, decision } of entries) {
      applyFlags(doc, decision.type, now);
      await doc.save();
    }
  }

  console.log(
    `🔔 Expiry sweep: ${summary.examined} examined, ${summary.due} due across ${byUser.size} user(s) — ` +
      `push ${summary.pushed} sent / ${summary.pushFailed} failed, ` +
      `email ${summary.emailed} sent / ${summary.emailFailed} failed / ${summary.emailSkipped} skipped`
  );

  return { ...summary, users: byUser.size };
};

module.exports = { runExpiryNotifications, decideNotification };
