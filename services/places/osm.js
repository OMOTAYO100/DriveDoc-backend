const axios = require('axios');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Overpass and Nominatim are volunteer-run. Identifying the client is required
// by Nominatim's usage policy and is good manners on Overpass.
const UA = 'DriveDoc/1.0 (+https://drivedoc.org)';

/**
 * Free fallback over OpenStreetMap.
 *
 * Unlike Google, OSM has a precise tag for this — `amenity=driving_school` —
 * so the match is exact rather than semantic. The trade-off is coverage:
 * OSM is community-contributed, so it is good in much of Europe and thin in
 * places where nobody has mapped them. Phone numbers are often missing.
 */
const searchOsm = async ({ lat, lng, radiusMetres, limit }) => {
  const radius = Math.min(radiusMetres, 50000);
  // Overpass `out` takes its parameters in a fixed order: verbosity (tags),
  // then geometry (center), then the limit. Getting that order wrong is a
  // syntax error the server reports as a bare HTTP 500.
  const query = `
    [out:json][timeout:20];
    (
      node["amenity"="driving_school"](around:${radius},${lat},${lng});
      way["amenity"="driving_school"](around:${radius},${lat},${lng});
    );
    out tags center ${Math.min(limit, 30)};
  `;

  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const { data } = await axios.post(endpoint, `data=${encodeURIComponent(query)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        timeout: 20000,
      });

      return (data.elements || [])
        .map((el) => {
          const t = el.tags || {};
          // Ways report their centroid under `center`; nodes carry lat/lon.
          const elLat = el.lat ?? el.center?.lat ?? null;
          const elLng = el.lon ?? el.center?.lon ?? null;
          if (elLat === null || elLng === null) return null;

          const address = [t['addr:housenumber'], t['addr:street'], t['addr:city'], t['addr:postcode']]
            .filter(Boolean)
            .join(' ');

          return {
            id: `osm-${el.type}-${el.id}`,
            source: 'osm',
            name: t.name || 'Driving school',
            address: address || null,
            lat: elLat,
            lng: elLng,
            phone: t.phone || t['contact:phone'] || null,
            website: t.website || t['contact:website'] || null,
            rating: null,
            ratingCount: null,
            mapsUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
            temporarilyClosed: false,
          };
        })
        .filter(Boolean);
    } catch (err) {
      lastError = err;
      // Try the next mirror — these are volunteer-run and rate-limited.
    }
  }

  throw lastError || new Error('No Overpass endpoint responded');
};

/**
 * Turn a typed place name into coordinates, so someone who won't share their
 * location can still search. Free, and the usage policy asks for a real
 * User-Agent and no more than one request per second.
 */
const geocodeOsm = async (query) => {
  const { data } = await axios.get(NOMINATIM, {
    params: { q: query, format: 'json', limit: 1 },
    headers: { 'User-Agent': UA },
    timeout: 8000,
  });

  if (!data?.length) return null;
  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    label: data[0].display_name,
  };
};

module.exports = { searchOsm, geocodeOsm };
