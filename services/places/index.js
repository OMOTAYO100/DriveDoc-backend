const { searchGoogle } = require('./google');
const { searchOsm, geocodeOsm } = require('./osm');

const DEFAULT_RADIUS_M = 15000;
const MAX_RESULTS = 12;

// Short-lived in-memory cache. Each Google search costs money, and people
// re-run the same search constantly.
//
// Deliberately in memory and short-lived, not persisted: Google Maps Platform
// terms restrict caching place content, so treat anything beyond a brief
// performance cache as something to check against the current terms.
const TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map();

const cacheKey = ({ lat, lng, query, radiusMetres }) =>
  query
    ? `q:${query.toLowerCase().trim()}`
    // ~1km buckets, so near-identical searches share an entry.
    : `g:${lat.toFixed(2)},${lng.toFixed(2)},${radiusMetres}`;

const readCache = (key) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return null;
  }
  return hit.value;
};

const writeCache = (key, value) => {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Drop the oldest insertion — Map preserves insertion order.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { value, expires: Date.now() + TTL_MS });
};

/** Great-circle distance in km. */
const distanceKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Find driving schools near a point, or near a typed place name.
 *
 * Google Places first for coverage and phone numbers; OpenStreetMap when
 * Google is unconfigured, errors, or finds nothing. Returns the provider used
 * so the UI can attribute the data, which both providers' terms require.
 */
const findDrivingSchools = async ({ lat, lng, query, radiusMetres = DEFAULT_RADIUS_M, limit = MAX_RESULTS }) => {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  if (!hasCoords && !query) {
    throw Object.assign(new Error('Provide either coordinates or a place to search'), {
      status: 400,
      expose: true,
    });
  }

  const key = cacheKey({ lat, lng, query, radiusMetres });
  const cached = readCache(key);
  if (cached) return { ...cached, cached: true };

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const warnings = [];
  let results = [];
  let provider = null;

  if (apiKey) {
    try {
      results = await searchGoogle({ lat, lng, query, radiusMetres, limit, apiKey });
      provider = 'google';
    } catch (err) {
      const detail = err.response?.data?.error?.message || err.message;
      console.error(`Places search failed, falling back to OSM: ${detail}`);
      warnings.push('google-failed');
    }
  } else {
    warnings.push('google-not-configured');
  }

  // Fall back when Google is unavailable or simply found nothing useful.
  if (!results.length) {
    let searchLat = lat;
    let searchLng = lng;

    if (!hasCoords) {
      const geo = await geocodeOsm(query);
      if (!geo) {
        return { results: [], provider: 'osm', warnings: [...warnings, 'place-not-found'], cached: false };
      }
      searchLat = geo.lat;
      searchLng = geo.lng;
    }

    try {
      results = await searchOsm({ lat: searchLat, lng: searchLng, radiusMetres, limit });
      provider = 'osm';
      lat = searchLat;
      lng = searchLng;
    } catch (err) {
      console.error(`OSM search failed: ${err.message}`);
      throw Object.assign(
        new Error('Driving school search is unavailable right now. Please try again shortly.'),
        { status: 503, expose: true }
      );
    }
  }

  // Annotate with distance and sort nearest-first, when we know where we are.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    results = results.map((r) => ({
      ...r,
      distanceKm:
        r.lat !== null && r.lng !== null
          ? Math.round(distanceKm(lat, lng, r.lat, r.lng) * 10) / 10
          : null,
    }));
    results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }

  const payload = { results: results.slice(0, limit), provider, warnings };
  writeCache(key, payload);
  return { ...payload, cached: false };
};

module.exports = { findDrivingSchools, distanceKm, DEFAULT_RADIUS_M, MAX_RESULTS, _cache: cache };
