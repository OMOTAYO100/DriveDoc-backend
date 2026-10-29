/**
 * Driving school discovery.
 *
 * Network calls to Google and Overpass are stubbed via axios — these tests
 * must never hit a paid API or a volunteer-run one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const { startTestServer, stopTestServer, app, signup, authed, request } = require('./helpers');
const { FIELD_MASK } = require('../services/places/google');

let token;
const realPost = axios.post;
const realGet = axios.get;

/** Capture outgoing calls and answer them with canned data. */
const stub = ({ googlePlaces, googleError, overpass, overpassError, nominatim }) => {
  const calls = { post: [], get: [] };

  axios.post = async (url, body, config) => {
    calls.post.push({ url, body, config });
    if (url.includes('places.googleapis.com')) {
      if (googleError) throw googleError;
      return { data: { places: googlePlaces || [] } };
    }
    if (url.includes('overpass')) {
      if (overpassError) throw overpassError;
      return { data: { elements: overpass || [] } };
    }
    // Anything else (e.g. Resend) behaves as before.
    return realPost(url, body, config);
  };

  axios.get = async (url, config) => {
    calls.get.push({ url, config });
    if (url.includes('nominatim')) return { data: nominatim || [] };
    return realGet(url, config);
  };

  return calls;
};

const restore = () => {
  axios.post = realPost;
  axios.get = realGet;
};

const clearCache = () => require('../services/places')._cache.clear();

const GOOGLE_PLACE = {
  id: 'place-1',
  displayName: { text: 'Citywide Driving School' },
  formattedAddress: '12 High Street, Leeds',
  location: { latitude: 53.8, longitude: -1.55 },
  nationalPhoneNumber: '0113 496 0000',
  websiteUri: 'https://example.com',
  rating: 4.6,
  userRatingCount: 231,
  googleMapsUri: 'https://maps.google.com/?cid=1',
  businessStatus: 'OPERATIONAL',
};

test.before(async () => {
  await startTestServer();
  const { res } = await signup();
  token = res.body.token;
});

test.after(stopTestServer);

test.beforeEach(clearCache);
test.afterEach(restore);

// --------------------------------------------------------------- access ---

test('searching requires a signed-in user', async () => {
  const res = await request(app()).get('/api/schools?lat=53.8&lng=-1.55');
  assert.equal(res.status, 401);
});

test('a search needs either coordinates or a place name', async () => {
  const res = await authed(request(app()).get('/api/schools'), token);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /location|town|city/i);
});

test('nonsense coordinates are rejected', async () => {
  const res = await authed(request(app()).get('/api/schools?lat=999&lng=0'), token);
  assert.equal(res.status, 400);
});

// --------------------------------------------------------------- google ---

test('finds schools near a point and reports the provider', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  stub({ googlePlaces: [GOOGLE_PLACE] });

  const res = await authed(request(app()).get('/api/schools?lat=53.81&lng=-1.56'), token);

  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'google');
  assert.equal(res.body.schools.length, 1);

  const s = res.body.schools[0];
  assert.equal(s.name, 'Citywide Driving School');
  assert.equal(s.phone, '0113 496 0000', 'the phone number is the whole point');
  assert.equal(s.website, 'https://example.com');
  assert.ok(typeof s.distanceKm === 'number', 'distance is computed');
  assert.ok(s.distanceKm < 5);
});

test('uses Text Search, not Nearby Search — there is no driving_school place type', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  const calls = stub({ googlePlaces: [GOOGLE_PLACE] });

  await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);

  const call = calls.post.find((c) => c.url.includes('places.googleapis.com'));
  assert.ok(call, 'Google was called');
  assert.match(call.url, /places:searchText/, 'must be Text Search');
  assert.ok(!call.url.includes('searchNearby'), 'Nearby Search matches a fixed type enum that has no driving_school, and would silently return nothing');
  assert.match(call.body.textQuery, /driving school/i);
  // A bias nudges, a restriction excludes — rural users need the nudge.
  assert.ok(call.body.locationBias, 'biases toward the user');
  assert.ok(!call.body.locationRestriction, 'does not hard-exclude distant schools');
});

test('asks for the fields the UI renders, including contact details', async () => {
  assert.match(FIELD_MASK, /places\.nationalPhoneNumber/);
  assert.match(FIELD_MASK, /places\.websiteUri/);
  assert.match(FIELD_MASK, /places\.location/);
  // The field mask drives billing, so nothing unused should creep in.
  assert.ok(!FIELD_MASK.includes('places.photos'), 'photos are expensive and unused');
  assert.ok(!FIELD_MASK.includes('places.reviews'), 'reviews are expensive and unused');
});

test('permanently closed schools are not shown', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  stub({
    googlePlaces: [GOOGLE_PLACE, { ...GOOGLE_PLACE, id: 'gone', businessStatus: 'CLOSED_PERMANENTLY' }],
  });

  const res = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);
  assert.equal(res.body.schools.length, 1);
  assert.equal(res.body.schools[0].id, 'place-1');
});

test('results come back nearest first', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  stub({
    googlePlaces: [
      { ...GOOGLE_PLACE, id: 'far', displayName: { text: 'Far' }, location: { latitude: 54.2, longitude: -1.55 } },
      { ...GOOGLE_PLACE, id: 'near', displayName: { text: 'Near' }, location: { latitude: 53.801, longitude: -1.551 } },
    ],
  });

  const res = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);
  assert.deepEqual(res.body.schools.map((s) => s.name), ['Near', 'Far']);
});

// ----------------------------------------------------------- fallbacks ---

test('falls back to OpenStreetMap when Google is not configured', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  stub({
    overpass: [
      {
        type: 'node',
        id: 42,
        lat: 53.802,
        lon: -1.552,
        tags: { name: 'Community Driving School', phone: '0113 111 2222', 'addr:city': 'Leeds' },
      },
    ],
  });

  const res = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'osm');
  assert.equal(res.body.schools[0].name, 'Community Driving School');
  assert.ok(res.body.warnings.includes('google-not-configured'));
});

test('falls back to OpenStreetMap when Google errors', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  stub({
    googleError: Object.assign(new Error('quota'), { response: { data: { error: { message: 'quota' } } } }),
    overpass: [{ type: 'node', id: 7, lat: 53.8, lon: -1.55, tags: { name: 'Backup School' } }],
  });

  const res = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'osm');
  assert.ok(res.body.warnings.includes('google-failed'));
});

test('an OSM way is located by its centroid, not dropped', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  stub({
    overpass: [{ type: 'way', id: 9, center: { lat: 53.805, lon: -1.553 }, tags: { name: 'Way School' } }],
  });

  const res = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);
  assert.equal(res.body.schools.length, 1);
  assert.equal(res.body.schools[0].name, 'Way School');
  assert.ok(res.body.schools[0].lat);
});

test('both providers down is a clear 503, not a crash', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  stub({ googleError: new Error('down'), overpassError: new Error('down') });

  const res = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);
  assert.equal(res.status, 503);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(res.body.success, false);
});

// ------------------------------------------------------ search by name ---

test('a typed place name works without sharing location', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  const calls = stub({ googlePlaces: [GOOGLE_PLACE] });

  const res = await authed(request(app()).get('/api/schools?q=Leeds'), token);
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'google');

  const call = calls.post.find((c) => c.url.includes('places.googleapis'));
  assert.match(call.body.textQuery, /Leeds/);
});

test('an unknown place name returns empty rather than erroring', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  stub({ nominatim: [] });

  const res = await authed(request(app()).get('/api/schools?q=Nowherelandia'), token);
  assert.equal(res.status, 200);
  assert.equal(res.body.schools.length, 0);
  assert.ok(res.body.warnings.includes('place-not-found'));
});

// ---------------------------------------------------------- the budget ---

test('an identical search is served from cache, not re-billed', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  const calls = stub({ googlePlaces: [GOOGLE_PLACE] });

  const first = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);
  const second = await authed(request(app()).get('/api/schools?lat=53.8&lng=-1.55'), token);

  assert.equal(first.body.cached, false);
  assert.equal(second.body.cached, true);
  const googleCalls = calls.post.filter((c) => c.url.includes('places.googleapis'));
  assert.equal(googleCalls.length, 1, 'the second search must not cost money');
});

test('nearby searches share a cache bucket', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  const calls = stub({ googlePlaces: [GOOGLE_PLACE] });

  // ~100m apart — the same neighbourhood, so one lookup should serve both.
  await authed(request(app()).get('/api/schools?lat=53.8001&lng=-1.5501'), token);
  await authed(request(app()).get('/api/schools?lat=53.8009&lng=-1.5509'), token);

  const googleCalls = calls.post.filter((c) => c.url.includes('places.googleapis'));
  assert.equal(googleCalls.length, 1);
});
