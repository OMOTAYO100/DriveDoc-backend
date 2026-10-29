const test = require('node:test');
const assert = require('node:assert/strict');
const { decideNotification } = require('./notifyExpiring');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-15T10:00:00.000Z');

const doc = (daysFromNow, notifications = {}) => ({
  _id: 'doc1',
  type: 'Driver License',
  number: 'DL-12345',
  expiryDate: new Date(NOW.getTime() + daysFromNow * DAY),
  notifications,
});

test('says nothing when expiry is far away', () => {
  assert.equal(decideNotification(doc(90), NOW), null);
  assert.equal(decideNotification(doc(31), NOW), null);
});

test('warns once inside the 30-day window', () => {
  const d = decideNotification(doc(25), NOW);
  assert.equal(d.type, 'monthBefore');
  // The old copy hardcoded "30 days" for anything in 8..30, telling a user
  // 11 days out that they had a month.
  assert.match(d.body, /expires in 25 days/);
});

test('does not repeat the month-before warning', () => {
  assert.equal(decideNotification(doc(25, { monthBeforeSent: true }), NOW), null);
});

test('switches to a daily countdown in the final week', () => {
  const d = decideNotification(doc(3), NOW);
  assert.equal(d.type, 'daily');
  assert.match(d.body, /expires in 3 days/);
});

test('uses the singular for the last day', () => {
  const d = decideNotification(doc(0.5), NOW);
  assert.equal(d.type, 'daily');
  assert.match(d.body, /expires in 1 day on/);
});

test('sends at most one daily reminder per calendar day', () => {
  const sentToday = { lastDailySentAt: new Date('2026-06-15T02:00:00.000Z') };
  assert.equal(decideNotification(doc(3, sentToday), NOW), null);

  const sentYesterday = { lastDailySentAt: new Date('2026-06-14T23:00:00.000Z') };
  assert.equal(decideNotification(doc(3, sentYesterday), NOW).type, 'daily');
});

test('reports an expired document once', () => {
  const d = decideNotification(doc(-2), NOW);
  assert.equal(d.type, 'expired');
  assert.match(d.body, /expired on/);
  assert.equal(decideNotification(doc(-2, { expiredSent: true }), NOW), null);
});

test('a monthBefore flag does not suppress the daily countdown', () => {
  // A document passes through both windows; having sent the 30-day warning
  // must not stop the final-week reminders.
  const d = decideNotification(doc(2, { monthBeforeSent: true }), NOW);
  assert.equal(d.type, 'daily');
});

test('an expired document still reports after the daily window', () => {
  const d = decideNotification(doc(-1, { monthBeforeSent: true, lastDailySentAt: NOW }), NOW);
  assert.equal(d.type, 'expired');
});

test('ignores a document with an unparseable expiry date', () => {
  assert.equal(decideNotification({ ...doc(5), expiryDate: 'not-a-date' }, NOW), null);
});

test('formats the date the same way regardless of server timezone', () => {
  const d = decideNotification(doc(-2), NOW);
  assert.match(d.body, /13 June 2026/);
});
