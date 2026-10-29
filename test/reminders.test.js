/**
 * Expiry reminders over two channels, and the renewal guidance they carry.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { startTestServer, stopTestServer, app, signup, authed, dayOffset, request } = require('./helpers');

test.before(startTestServer);
test.after(stopTestServer);

// ----------------------------------------------------------- guidance ---

test('guidance is served for a country we tailor', async () => {
  const res = await request(app()).get('/api/guidance?country=Nigeria&type=Driver%20License');
  assert.equal(res.status, 200);
  assert.equal(res.body.guidance.tailored, true);
  assert.ok(res.body.guidance.officialUrl);
  // Public editorial content — cacheable, and no auth required.
  assert.match(res.headers['cache-control'], /max-age/);
});

test('guidance falls back rather than failing for an unlisted country', async () => {
  const res = await request(app()).get('/api/guidance?country=Japan&type=Driver%20License');
  assert.equal(res.status, 200);
  assert.equal(res.body.guidance.tailored, false, 'honest that it is not country-specific');
  assert.ok(res.body.guidance.bring.length, 'still useful');
});

test('guidance needs a document type', async () => {
  const res = await request(app()).get('/api/guidance?country=Nigeria');
  assert.equal(res.status, 400);
});

test('the document catalog is served', async () => {
  const res = await request(app()).get('/api/guidance/catalog');
  assert.equal(res.status, 200);
  assert.ok(res.body.byCountry.Nigeria.includes('Driver License'));
  assert.ok(res.body.generic.includes('Other'));
});

// -------------------------------------------------- email preferences ---

test('new accounts get email reminders by default', async () => {
  const { res } = await signup();
  assert.equal(res.body.user.emailReminders, true);
});

test('email reminders can be turned off and back on while signed in', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;

  const off = await authed(request(app()).put('/api/notifications/email'), token).send({ enabled: false });
  assert.equal(off.status, 200);

  const me = await authed(request(app()).get('/api/auth/me'), token);
  assert.equal(me.body.user.emailReminders, false);

  await authed(request(app()).put('/api/notifications/email'), token).send({ enabled: true });
  const me2 = await authed(request(app()).get('/api/auth/me'), token);
  assert.equal(me2.body.user.emailReminders, true);
});

test('the preference endpoint rejects a non-boolean', async () => {
  const { res: signupRes } = await signup();
  const res = await authed(request(app()).put('/api/notifications/email'), signupRes.body.token).send({
    enabled: 'yes',
  });
  assert.equal(res.status, 400);
});

test('the unsubscribe link works with no session, and a forged token does nothing', async () => {
  const { res: signupRes } = await signup();
  const userId = signupRes.body.user.id;
  const { unsubscribeToken } = require('../utils/mailer');
  const User = require('../models/user');

  const forged = await request(app()).get(`/api/notifications/email/unsubscribe?u=${userId}&t=deadbeef`);
  assert.equal(forged.status, 400);
  assert.equal((await User.findById(userId)).emailReminders, true, 'a bad token must not unsubscribe');

  // The real link carries no Authorization header — it is clicked from an inbox.
  const real = await request(app()).get(
    `/api/notifications/email/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`
  );
  assert.equal(real.status, 200);
  // Opened by a person in a browser, so HTML here is deliberate.
  assert.match(real.headers['content-type'], /text\/html/);
  assert.equal((await User.findById(userId)).emailReminders, false);
});

test('one-click unsubscribe (RFC 8058 POST) works too', async () => {
  const { res: signupRes } = await signup();
  const userId = signupRes.body.user.id;
  const { unsubscribeToken } = require('../utils/mailer');

  const res = await request(app()).post(
    `/api/notifications/email/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}`
  );
  assert.equal(res.status, 200);

  const User = require('../models/user');
  assert.equal((await User.findById(userId)).emailReminders, false);
});

test("one user's unsubscribe token does not work on another account", async () => {
  const { res: a } = await signup();
  const { res: b } = await signup();
  const { unsubscribeToken } = require('../utils/mailer');

  const res = await request(app()).get(
    `/api/notifications/email/unsubscribe?u=${b.body.user.id}&t=${unsubscribeToken(a.body.user.id)}`
  );
  assert.equal(res.status, 400);

  const User = require('../models/user');
  assert.equal((await User.findById(b.body.user.id)).emailReminders, true);
});

// --------------------------------------------------------- the sweep ---

test('one email per user covers every document due, and the sweep is idempotent', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;
  const userId = signupRes.body.user.id;

  for (const [type, days] of [
    ['Driver License', 3],
    ['Insurance Certificate', 5],
    ['Vehicle License', -2],
  ]) {
    await authed(request(app()).post('/api/documents'), token).send({
      country: 'Nigeria',
      type,
      number: `N-${days}`,
      expiryDate: dayOffset(days),
    });
  }

  const { runExpiryNotifications } = require('../jobs/notifyExpiring');
  const summary = await runExpiryNotifications();

  assert.equal(summary.due, 3, 'all three are due');
  assert.equal(summary.users, 1, 'grouped under one user');
  // With no RESEND_API_KEY the email is composed and logged rather than sent.
  // 'skipped: 1' is the proof that ONE email was built, not three.
  assert.equal(summary.emailSkipped, 1);

  const second = await runExpiryNotifications();
  assert.equal(second.due, 0, 'flags make a same-day re-run a no-op');

  const Document = require('../models/Documents');
  const docs = await Document.find({ user: userId });
  assert.ok(docs.some((d) => d.notifications.expiredSent), 'expired flag recorded');
  assert.ok(docs.some((d) => d.notifications.lastDailySentAt), 'daily flag recorded');
});

test('a user who opted out of email still gets their flags recorded', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;

  await authed(request(app()).put('/api/notifications/email'), token).send({ enabled: false });
  await authed(request(app()).post('/api/documents'), token).send({
    country: 'Nigeria',
    type: 'Driver License',
    number: 'OPTOUT-1',
    expiryDate: dayOffset(4),
  });

  const { runExpiryNotifications } = require('../jobs/notifyExpiring');
  const summary = await runExpiryNotifications();
  assert.equal(summary.emailed, 0);

  // Without this, switching email back on later would deliver a backlog.
  const Document = require('../models/Documents');
  const doc = await Document.findOne({ number: 'OPTOUT-1' });
  assert.ok(doc.notifications.lastDailySentAt);
});

test('a document far from expiry is left alone', async () => {
  const { res: signupRes } = await signup();
  await authed(request(app()).post('/api/documents'), signupRes.body.token).send({
    country: 'Nigeria',
    type: 'Driver License',
    number: 'FAR-1',
    expiryDate: dayOffset(300),
  });

  const { runExpiryNotifications } = require('../jobs/notifyExpiring');
  const summary = await runExpiryNotifications();
  assert.equal(summary.due, 0);
});

// ------------------------------------------------------ email content ---

test('the reminder email names the document and who to renew it with', () => {
  const { expiryReminderEmail } = require('../utils/mailer');
  const { getGuidance } = require('../data/renewalGuidance');

  const { subject, text, html, headers } = expiryReminderEmail(
    { _id: 'abc123', fullName: 'Ada Lovelace' },
    [
      {
        document: { type: 'Driver License', number: 'DL-1' },
        kind: 'upcoming',
        days: 3,
        expiryLabel: '11 October 2026',
        guidance: getGuidance('Nigeria', 'Driver License'),
      },
    ],
    'https://drivedoc.org'
  );

  assert.match(subject, /Driver License/);
  assert.match(text, /Ada/);
  assert.match(text, /FRSC|Federal Road Safety/, 'tells them who to renew with');
  assert.match(html, /Driver License/);
  assert.match(text, /unsubscribe/i, 'every reminder offers a way out');
  assert.ok(headers['List-Unsubscribe'], 'native unsubscribe header for Gmail/Outlook');
  assert.ok(headers['List-Unsubscribe-Post'], 'one-click support');
});

test('the subject reflects how many documents and how urgent', () => {
  const { expiryReminderEmail } = require('../utils/mailer');
  const { getGuidance } = require('../data/renewalGuidance');
  const g = getGuidance('Nigeria', 'Driver License');
  const item = (type, kind, days) => ({
    document: { type, number: 'X' },
    kind,
    days,
    expiryLabel: '11 October 2026',
    guidance: g,
  });

  const one = expiryReminderEmail({ _id: 'a', fullName: 'Ada' }, [item('Driver License', 'expired', 2)], 'https://x');
  assert.match(one.subject, /has expired/);

  const many = expiryReminderEmail(
    { _id: 'a', fullName: 'Ada' },
    [item('Driver License', 'upcoming', 3), item('Insurance Certificate', 'upcoming', 9)],
    'https://x'
  );
  assert.match(many.subject, /2 documents/);
  assert.match(many.subject, /3 days/, 'leads with the most urgent');
});

test('the reminder email escapes user-supplied text', () => {
  const { expiryReminderEmail } = require('../utils/mailer');
  const { getGuidance } = require('../data/renewalGuidance');

  const { html } = expiryReminderEmail(
    { _id: 'abc123', fullName: 'Ada' },
    [
      {
        document: { type: '<script>alert(1)</script>', number: '"><img src=x>' },
        kind: 'upcoming',
        days: 3,
        expiryLabel: '11 October 2026',
        guidance: getGuidance('Nigeria', 'Other'),
      },
    ],
    'https://drivedoc.org'
  );

  assert.ok(!html.includes('<script>alert(1)</script>'), 'document type must be escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
});
