const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { findDrivingSchools, DEFAULT_RADIUS_M } = require('../services/places');

const router = express.Router();

// Every uncached search costs real money at Google. Signed-in only, and
// limited per user rather than per IP so one shared network can't be starved
// by a single heavy user — or run up the bill.
const searchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message: 'Too many searches. Please wait a few minutes and try again.',
    }),
});

// @desc    Driving schools near a point, or near a named place
// @route   GET /api/schools?lat=..&lng=..            (nearby)
//          GET /api/schools?q=Leeds                  (by place name)
// @access  Private
router.get('/', protect, searchLimiter, async (req, res, next) => {
  try {
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';

    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    if (hasCoords && (lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
      return res.status(400).json({ success: false, message: 'Those coordinates are not valid' });
    }

    if (!hasCoords && !query) {
      return res.status(400).json({
        success: false,
        message: 'Share your location or type a town or city to search',
      });
    }

    const radiusMetres = Number(req.query.radius) || DEFAULT_RADIUS_M;

    const { results, provider, warnings, cached } = await findDrivingSchools({
      lat: hasCoords ? lat : undefined,
      lng: hasCoords ? lng : undefined,
      query: hasCoords ? '' : query,
      radiusMetres: Math.min(Math.max(radiusMetres, 1000), 50000),
    });

    res.status(200).json({
      success: true,
      count: results.length,
      provider,
      cached,
      warnings,
      schools: results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
