const axios = require('axios');

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Fields we ask for. The field mask decides both the response shape AND the
 * billing SKU: a request is billed at the highest tier any requested field
 * belongs to.
 *
 *   Pro        displayName, formattedAddress, location, businessStatus,
 *              googleMapsUri            → 5,000 free calls/month
 *   Enterprise nationalPhoneNumber, websiteUri, rating, userRatingCount
 *                                       → 1,000 free calls/month
 *
 * We ask for the phone number, so every search bills at Enterprise. That is a
 * deliberate trade, not an oversight: the user's whole next action is to ring
 * the school, and a listing without a number is useless. Rating and website
 * ride along at no extra cost once the request is already Enterprise.
 *
 * If volume ever outgrows the Enterprise free tier, the fix is to split this:
 * search with Pro fields only, then fetch contact details for the one school
 * the user actually taps. Twelve results would cost one Pro call instead of
 * twelve Enterprise ones.
 */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

/**
 * Why Text Search and not Nearby Search:
 *
 * Nearby Search matches on a fixed enum of place types, and `driving_school`
 * is NOT in it — the Education category stops at school/university. Asking for
 * it returns nothing at all, silently. Text Search matches semantically, so
 * "driving school" finds them, and the same call handles a typed place name
 * ("driving schools in Leeds") as well as a location bias.
 */
const searchGoogle = async ({ lat, lng, query, radiusMetres, limit, apiKey }) => {
  const body = {
    textQuery: query ? `driving school ${query}` : 'driving school',
    maxResultCount: Math.min(limit, 20),
    languageCode: 'en',
  };

  // A bias nudges results toward the area; a restriction would hard-exclude
  // anything outside it, which is wrong when someone is rurally located and
  // the nearest school is 40km away.
  if (typeof lat === 'number' && typeof lng === 'number') {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: Math.min(radiusMetres, 50000),
      },
    };
  }

  const { data } = await axios.post(ENDPOINT, body, {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    timeout: 8000,
  });

  return (data.places || [])
    // Don't send people to a school that has closed down.
    .filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY')
    .map((p) => ({
      id: p.id,
      source: 'google',
      name: p.displayName?.text || 'Driving school',
      address: p.formattedAddress || null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      phone: p.nationalPhoneNumber || p.internationalPhoneNumber || null,
      website: p.websiteUri || null,
      rating: typeof p.rating === 'number' ? p.rating : null,
      ratingCount: p.userRatingCount ?? null,
      mapsUrl: p.googleMapsUri || null,
      temporarilyClosed: p.businessStatus === 'CLOSED_TEMPORARILY',
    }));
};

module.exports = { searchGoogle, FIELD_MASK };
