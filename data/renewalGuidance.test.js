const test = require('node:test');
const assert = require('node:assert/strict');
const { getGuidance, inferBase, COUNTRIES, GENERIC } = require('./renewalGuidance');
const { SPECIFIC_DOCUMENTS, GENERIC_DOCUMENTS } = require('./countryDocuments');

test('returns tailored guidance where we have it', () => {
  const g = getGuidance('Nigeria', 'Driver License');
  assert.equal(g.tailored, true);
  assert.match(g.authority, /FRSC|Federal Road Safety/);
  assert.ok(g.officialUrl);
  assert.ok(g.bring.length > 0);
});

test('falls back to generic guidance for an unlisted country', () => {
  const g = getGuidance('Japan', 'Driver License');
  assert.equal(g.tailored, false, 'must be honest that this is not country-specific');
  assert.ok(g.bring.length > 0, 'still useful');
  assert.match(g.title, /driving licence/i);
});

test('never returns nothing, whatever it is handed', () => {
  for (const args of [
    ['Nigeria', 'Something We Never Listed'],
    [undefined, 'Driver License'],
    ['', ''],
    [null, null],
  ]) {
    const g = getGuidance(...args);
    assert.ok(g, `no guidance for ${JSON.stringify(args)}`);
    assert.ok(g.title);
    assert.ok(Array.isArray(g.bring));
  }
});

test('distinguishes a driving licence from a vehicle licence', () => {
  // "Vehicle License" (Nigeria) and "License Disc" (South Africa) are road tax,
  // not permission to drive. Conflating them would give actively wrong advice.
  assert.equal(inferBase('Driver License'), 'licence');
  assert.equal(inferBase('Driving Licence'), 'licence');
  assert.equal(inferBase('Vehicle License'), 'roadTax');
  assert.equal(inferBase('License Disc'), 'roadTax');
  assert.equal(inferBase('International Driving Permit'), 'idp');
});

test('classifies the other document kinds', () => {
  assert.equal(inferBase('Insurance Certificate'), 'insurance');
  assert.equal(inferBase('MOT Certificate'), 'roadworthiness');
  assert.equal(inferBase('Road Worthiness Certificate'), 'roadworthiness');
  assert.equal(inferBase('Emissions Certificate'), 'roadworthiness');
  assert.equal(inferBase('Road Tax (VED)'), 'roadTax');
  assert.equal(inferBase('Vehicle Registration (V5C)'), 'registration');
  assert.equal(inferBase('Vehicle Title'), 'registration');
  assert.equal(inferBase('Hackney Permit'), 'permit');
  assert.equal(inferBase('Other'), 'other');
});

test('every document type the app offers resolves to usable guidance', () => {
  // The UI lets a user pick any of these, so none may fall through.
  const pairs = [];
  for (const [country, types] of Object.entries(SPECIFIC_DOCUMENTS)) {
    for (const t of types) pairs.push([country, t]);
  }
  for (const t of GENERIC_DOCUMENTS) pairs.push(['Japan', t]);

  for (const [country, type] of pairs) {
    const g = getGuidance(country, type);
    assert.ok(g.title, `${country} / ${type}: no title`);
    assert.ok(g.authority, `${country} / ${type}: no authority`);
    assert.ok(g.bring?.length, `${country} / ${type}: nothing to bring`);
    assert.ok(typeof g.startBefore === 'number', `${country} / ${type}: no lead time`);
  }
});

test('every tailored entry carries a verifiable official source', () => {
  // Costs and rules go stale. A user must always be able to check for
  // themselves, so a country-specific entry without a source is a bug.
  for (const [country, entries] of Object.entries(COUNTRIES)) {
    for (const type of Object.keys(entries)) {
      if (type.startsWith('_')) continue;
      const g = getGuidance(country, type);
      assert.ok(g.officialUrl, `${country} / ${type} has no officialUrl`);
      assert.match(g.officialUrl, /^https:\/\//, `${country} / ${type} url is not https`);
    }
  }
});

test('every entry is dated so the UI can show staleness', () => {
  const g = getGuidance('United Kingdom', 'MOT Certificate');
  assert.match(g.lastReviewed, /^\d{4}-\d{2}-\d{2}$/);
});

test('generic bases all have the fields the UI and emails read', () => {
  for (const [key, base] of Object.entries(GENERIC)) {
    assert.ok(base.title, `${key}: no title`);
    assert.ok(base.authority, `${key}: no authority`);
    assert.ok(Array.isArray(base.bring) && base.bring.length, `${key}: no bring list`);
    assert.ok(typeof base.startBefore === 'number', `${key}: no startBefore`);
  }
});

test('country-specific detail overrides the generic base', () => {
  const generic = getGuidance('Japan', 'Insurance Certificate');
  const nigeria = getGuidance('Nigeria', 'Insurance Certificate');
  assert.notEqual(nigeria.authority, generic.authority);
  assert.match(nigeria.notes, /askNIID|NIID/i, 'should keep the local, specific advice');
});

test('does not leak the internal base key to clients', () => {
  const g = getGuidance('Nigeria', 'Driver License');
  assert.equal(g.base, undefined);
});
