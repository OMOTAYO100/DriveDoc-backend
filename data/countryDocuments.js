/**
 * Document types offered per country.
 *
 * ⚠️  This list is duplicated in the web app at
 *     my-project/src/utils/countryData.js, which uses it for the Add Document
 *     dropdowns without a network round-trip. Keep the two in step — the
 *     coverage test in renewalGuidance.test.js asserts that every type listed
 *     HERE resolves to usable renewal guidance, so a type added only on the
 *     frontend would ship without guidance and nothing would catch it.
 *
 *     `GET /api/guidance/catalog` serves this, so the frontend can converge on
 *     it as the single source when that is worth a fetch.
 */

const GENERIC_DOCUMENTS = [
  'Driver License',
  'International Driving Permit',
  'Vehicle Registration / Title',
  'Insurance Certificate',
  'Vehicle Inspection / Roadworthiness',
  'Road Tax / License Disc',
  'Commercial Driver License',
  'Other',
];

const SPECIFIC_DOCUMENTS = {
  Nigeria: [
    'Driver License',
    'Vehicle Registration',
    'Insurance Certificate',
    'Road Worthiness Certificate',
    'Vehicle License',
    'Hackney Permit',
    'FRSC Number Plate',
    'Change of Ownership',
    'Other',
  ],
  'United States': [
    'Driver License',
    'Vehicle Registration',
    'Insurance Certificate',
    'Emissions Certificate',
    'Vehicle Title',
    'Commercial Driver License (CDL)',
    'Other',
  ],
  'United Kingdom': [
    'Driving Licence',
    'Vehicle Registration (V5C)',
    'MOT Certificate',
    'Insurance Certificate',
    'Road Tax (VED)',
    'Commercial Operator License',
    'Other',
  ],
  Ghana: [
    'Driver License',
    'Vehicle Registration',
    'Insurance Certificate',
    'Road Worthiness Certificate',
    'DVLA Number Plate',
    'Other',
  ],
  'South Africa': [
    'Driver License',
    'Vehicle Registration',
    'License Disc',
    'Insurance Certificate',
    'Roadworthy Certificate',
    'Other',
  ],
};

const getDocumentsForCountry = (country) => {
  if (!country) return [];
  return SPECIFIC_DOCUMENTS[country] || GENERIC_DOCUMENTS;
};

module.exports = { GENERIC_DOCUMENTS, SPECIFIC_DOCUMENTS, getDocumentsForCountry };
