/**
 * Integration tests against the real Express app and a real (in-memory)
 * MongoDB. These cover the paths where a regression would be invisible until
 * a user hit it: authorisation, consent, field whitelisting and slot booking.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

let mongod;
let app;

const PASSWORD = 'CorrectHorse1';

const signup = async (overrides = {}) => {
  const body = {
    fullName: 'Test Driver',
    email: `user${Math.random().toString(36).slice(2)}@example.com`,
    phone: '+2348000000000',
    country: 'Nigeria',
    password: PASSWORD,
    termsAccepted: true,
    ...overrides,
  };
  const res = await request(app).post('/api/auth/signup').send(body);
  return { res, body };
};

const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);

test.before(async () => {
  mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-123456';
  process.env.NODE_ENV = 'test';
  process.env.CLIENT_URL = 'http://localhost:5173';
  process.env.CRON_SECRET = 'cron-test-secret';
  process.env.DISABLE_DEV_SWEEP = 'true';
  delete process.env.RESEND_API_KEY; // reset emails get logged, not sent

  app = require('../server');
  await mongoose.connection.asPromise();
});

test.after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------------------------------------------------------------- health ---

test('health check reports JSON', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('an unknown API route answers with JSON, not an HTML error page', async () => {
  const res = await request(app).get('/api/this-does-not-exist');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.success, false);
});

test('the removed payments endpoint 404s as JSON', async () => {
  const res = await request(app).post('/api/payments/verify').send({ reference: 'x' });
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /application\/json/);
});

// ------------------------------------------------------------------ auth ---

test('signup creates an account and returns a token', async () => {
  const { res, body } = await signup();
  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, body.email.toLowerCase());
  // The password must never come back.
  assert.equal(res.body.user.password, undefined);
});

test('signup is refused without accepting the terms', async () => {
  const { res } = await signup({ termsAccepted: false });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Terms/i);
});

test('signup records when the terms were accepted', async () => {
  const { body } = await signup();
  const User = require('../models/user');
  const user = await User.findOne({ email: body.email.toLowerCase() });
  assert.ok(user.termsAcceptedAt instanceof Date);
  assert.ok(user.termsVersion);
});

test('signup rejects a weak password', async () => {
  const { res } = await signup({ password: 'alllowercase' });
  assert.equal(res.status, 400);
});

test('login works and wrong credentials are indistinguishable', async () => {
  const { body } = await signup();

  const ok = await request(app).post('/api/auth/login').send({ email: body.email, password: PASSWORD });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const wrongPass = await request(app)
    .post('/api/auth/login')
    .send({ email: body.email, password: 'WrongPassword1' });
  const noSuchUser = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nobody@example.com', password: 'WrongPassword1' });

  assert.equal(wrongPass.status, 401);
  assert.equal(noSuchUser.status, 401);
  // Same message, so the endpoint can't be used to find out who has an account.
  assert.equal(wrongPass.body.message, noSuchUser.body.message);
});

test('protected routes reject a missing or bad token', async () => {
  const none = await request(app).get('/api/documents');
  assert.equal(none.status, 401);

  const bad = await authed(request(app).get('/api/documents'), 'not-a-jwt');
  assert.equal(bad.status, 401);
});

test('a Google access token is no longer accepted as a credential', async () => {
  // The old handler took `accessToken` and trusted the email behind it, so a
  // token minted for any other app could sign in here.
  const res = await request(app).post('/api/auth/oauth/google').send({ accessToken: 'ya29.fake' });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /credential/i);
});

test('a forged Google credential is rejected', async () => {
  const res = await request(app).post('/api/auth/oauth/google').send({ credential: 'not.a.jwt' });
  assert.ok(res.status === 401 || res.status === 500);
  assert.notEqual(res.body.success, true);
});

// -------------------------------------------------------- password reset ---

test('forgot-password answers identically for known and unknown emails', async () => {
  const { body } = await signup();

  const known = await request(app).post('/api/auth/forgot-password').send({ email: body.email });
  const unknown = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'ghost@example.com' });

  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(known.body.message, unknown.body.message);
});

test('a reset token sets a new password and is single-use', async () => {
  const { body } = await signup();
  const User = require('../models/user');

  const user = await User.findOne({ email: body.email.toLowerCase() });
  const plainToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const newPassword = 'BrandNewPass9';
  const first = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: plainToken, password: newPassword });
  assert.equal(first.status, 200);

  // The new password works...
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: body.email, password: newPassword });
  assert.equal(login.status, 200);

  // ...the old one doesn't...
  const old = await request(app)
    .post('/api/auth/login')
    .send({ email: body.email, password: PASSWORD });
  assert.equal(old.status, 401);

  // ...and the token can't be replayed.
  const replay = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: plainToken, password: 'AnotherPass1' });
  assert.equal(replay.status, 400);
});

test('an expired reset token is refused', async () => {
  const { body } = await signup();
  const User = require('../models/user');

  const user = await User.findOne({ email: body.email.toLowerCase() });
  const plainToken = user.createPasswordResetToken();
  user.resetPasswordExpire = new Date(Date.now() - 1000);
  await user.save({ validateBeforeSave: false });

  const res = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: plainToken, password: 'BrandNewPass9' });
  assert.equal(res.status, 400);
});

// ------------------------------------------------------------- documents ---

const makeDoc = (token, extra = {}) =>
  authed(request(app).post('/api/documents'), token).send({
    country: 'Nigeria',
    type: 'Driver License',
    number: 'DL-12345',
    expiryDate: '2027-01-01',
    ...extra,
  });

test('a document is created against its owner', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;

  const res = await makeDoc(token);
  assert.equal(res.status, 201);
  assert.equal(res.body.document.user, signupRes.body.user.id);
});

test('a client cannot set protected fields when creating a document', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;

  const res = await makeDoc(token, {
    // Pre-setting this would silence the document's own expiry reminders.
    notifications: { expiredSent: true, monthBeforeSent: true },
    status: 'valid',
    user: new mongoose.Types.ObjectId().toString(),
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.document.user, signupRes.body.user.id);
  assert.equal(res.body.document.notifications.expiredSent, false);
  assert.equal(res.body.document.notifications.monthBeforeSent, false);
});

test('a client cannot reassign a document to another user', async () => {
  const { res: aliceRes } = await signup();
  const { res: bobRes } = await signup();
  const alice = aliceRes.body.token;
  const bobId = bobRes.body.user.id;

  const created = await makeDoc(alice);
  const docId = created.body.document._id;

  // The exploit: PUT with someone else's id used to move the document into
  // their dashboard.
  const res = await authed(request(app).put(`/api/documents/${docId}`), alice).send({
    user: bobId,
    number: 'DL-99999',
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.document.user, aliceRes.body.user.id, 'ownership must not move');
  assert.equal(res.body.document.number, 'DL-99999', 'allowed fields still update');

  // And it never shows up for Bob.
  const bobDocs = await authed(request(app).get('/api/documents'), bobRes.body.token);
  assert.equal(bobDocs.body.documents.length, 0);
});

test("another user cannot read, edit or delete someone's document", async () => {
  const { res: aliceRes } = await signup();
  const { res: malloryRes } = await signup();

  const created = await makeDoc(aliceRes.body.token);
  const docId = created.body.document._id;
  const mallory = malloryRes.body.token;

  const edit = await authed(request(app).put(`/api/documents/${docId}`), mallory).send({ number: 'X' });
  assert.equal(edit.status, 403);

  const del = await authed(request(app).delete(`/api/documents/${docId}`), mallory);
  assert.equal(del.status, 403);

  const list = await authed(request(app).get('/api/documents'), mallory);
  assert.equal(list.body.documents.length, 0);
});

test('a document without an expiry date is refused with a clear message', async () => {
  const { res: signupRes } = await signup();
  const res = await authed(request(app).post('/api/documents'), signupRes.body.token).send({
    country: 'Nigeria',
    type: 'Driver License',
    number: 'DL-1',
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /expiry/i);
});

// --------------------------------------------------------- notifications ---

test('opting out is not undone by re-subscribing', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };

  await authed(request(app).post('/api/notifications/subscribe'), token).send(sub);
  await authed(request(app).post('/api/notifications/opt-out'), token).send({
    endpoint: sub.endpoint,
  });

  // This is what main.jsx does on every page load. It used to flip `enabled`
  // back to true, so opting out only lasted until the next refresh.
  const again = await authed(request(app).post('/api/notifications/subscribe'), token).send(sub);
  assert.equal(again.body.enabled, false, 'opt-out must survive a re-subscribe');

  const User = require('../models/user');
  const user = await User.findById(signupRes.body.user.id);
  assert.equal(user.pushSubscriptions[0].enabled, false);
  assert.equal(user.pushSubscriptions.length, 1, 'no duplicate subscription rows');
});

// --------------------------------------------------------------- account ---

test('deleting an account removes its documents', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;
  const userId = signupRes.body.user.id;

  await makeDoc(token);

  const res = await authed(request(app).delete('/api/auth/me'), token);
  assert.equal(res.status, 200);

  const User = require('../models/user');
  const Document = require('../models/Documents');

  assert.equal(await User.findById(userId), null);
  assert.equal(await Document.countDocuments({ user: userId }), 0);

  // The token is now worthless even though it hasn't expired.
  const after = await authed(request(app).get('/api/documents'), token);
  assert.equal(after.status, 401);
});

test('data export returns the account and documents', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;
  await makeDoc(token);

  const res = await authed(request(app).get('/api/auth/me/export'), token);
  assert.equal(res.status, 200);
  assert.equal(res.body.documents.length, 1);
  assert.ok(res.body.account.email);
  assert.equal(res.body.account.password, undefined);
});

test('a Google user can complete their profile', async () => {
  const { res: signupRes } = await signup();
  const token = signupRes.body.token;

  const res = await authed(request(app).put('/api/auth/me'), token).send({
    phone: '+2348011111111',
    country: 'Ghana',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.country, 'Ghana');
  assert.equal(res.body.user.profileComplete, true);
});

// ------------------------------------------------------------- cron guard ---

test('the expiry sweep endpoint needs the shared secret', async () => {
  const noHeader = await request(app).post('/api/jobs/notify-expiring');
  assert.equal(noHeader.status, 401);

  const wrong = await request(app)
    .post('/api/jobs/notify-expiring')
    .set('x-cron-secret', 'wrong');
  assert.equal(wrong.status, 401);

  const right = await request(app)
    .post('/api/jobs/notify-expiring')
    .set('x-cron-secret', process.env.CRON_SECRET);
  assert.equal(right.status, 200);
  assert.equal(right.body.success, true);
});
