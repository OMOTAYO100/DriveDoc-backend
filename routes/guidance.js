const express = require('express');
const { getGuidance } = require('../data/renewalGuidance');
const { SPECIFIC_DOCUMENTS, GENERIC_DOCUMENTS } = require('../data/countryDocuments');

const router = express.Router();

// @desc    Renewal guidance for a country + document type
// @route   GET /api/guidance?country=Nigeria&type=Driver%20License
// @access  Public — editorial content, nothing user-specific
router.get('/', (req, res) => {
  const { country, type } = req.query;

  if (!type) {
    return res.status(400).json({ success: false, message: 'A document type is required' });
  }

  const guidance = getGuidance(country, type);

  // Static content: let the browser and any CDN hold on to it.
  res.set('Cache-Control', 'public, max-age=3600');
  res.status(200).json({ success: true, guidance });
});

// @desc    The document types offered per country
// @route   GET /api/guidance/catalog
// @access  Public
router.get('/catalog', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.status(200).json({ success: true, generic: GENERIC_DOCUMENTS, byCountry: SPECIFIC_DOCUMENTS });
});

module.exports = router;
