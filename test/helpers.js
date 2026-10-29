/**
 * Shared setup for integration tests: a real Express app against a real
 * (in-memory) MongoDB. Nothing here ever touches the live Atlas cluster.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

const PASSWORD = 'CorrectHorse1';

const state = { mongod: null, app: null };

const startTestServer = async () => {
  state.mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = state.mongod.getUri();
  process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-123456';
  process.env.NODE_ENV = 'test';
  process.env.CLIENT_URL = 'http://localhost:5173';
  process.env.API_PUBLIC_URL = 'http://localhost:5000';
  process.env.CRON_SECRET = 'cron-test-secret';
  process.env.DISABLE_DEV_SWEEP = 'true';
  // No mail provider in tests: emails are composed and logged, never sent.
  delete process.env.RESEND_API_KEY;

  state.app = require('../server');
  await mongoose.connection.asPromise();
  return state.app;
};

const stopTestServer = async () => {
  await mongoose.disconnect();
  await state.mongod?.stop();
};

const app = () => state.app;

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
  const res = await request(state.app).post('/api/auth/signup').send(body);
  return { res, body };
};

const authed = (req, token) => req.set('Authorization', `Bearer ${token}`);

/** A YYYY-MM-DD date N days from now (negative for the past). */
const dayOffset = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

module.exports = { startTestServer, stopTestServer, app, signup, authed, dayOffset, PASSWORD, request };
