/**
 * Renewal guidance: what to actually do when a document is expiring.
 *
 * This is the single source of truth — the API serves it to the web app, and
 * the expiry reminder emails embed a condensed version. Don't fork it.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IMPORTANT — this is editorial content, not an integration.
 *
 * Government fees, requirements and processing times change, and they vary by
 * state, region and office. Every entry therefore:
 *   • quotes costs as a RANGE, never an exact figure
 *   • carries an `officialUrl` so the user can confirm for themselves
 *   • carries `lastReviewed`, which the UI shows, so staleness is visible
 *
 * Review these before launch and re-check them on a schedule. An entry that is
 * confidently wrong is worse than no entry at all.
 * ──────────────────────────────────────────────────────────────────────────
 */

const LAST_REVIEWED = '2026-10-08';

/**
 * Fallbacks keyed by the kind of document rather than its local name, so a
 * driver in any of the 190+ supported countries gets something useful even
 * where we have no country-specific entry.
 */
const GENERIC = {
  licence: {
    title: 'Renewing a driving licence',
    authority: 'Your national or state driving licence authority',
    where: 'Usually a licensing office, or an online portal if your country has one.',
    bring: [
      'Your current (or most recently expired) licence',
      'Proof of identity',
      'Proof of address',
      'A recent passport photograph',
      'Payment for the renewal fee',
    ],
    cost: 'Varies widely by country.',
    processingTime: 'Often same-day for a temporary document, with the permanent card following by post.',
    startBefore: 30,
    penalty:
      'Driving on an expired licence is an offence almost everywhere, and it can invalidate your insurance.',
    notes:
      'Many authorities let you renew a few months early without losing the remaining validity. Check before you wait.',
  },

  insurance: {
    title: 'Renewing vehicle insurance',
    authority: 'Your insurer or broker',
    where: 'Directly with your insurer, or compare the market before renewing.',
    bring: [
      'Your policy number',
      'Vehicle registration details',
      'Current mileage or usage estimate',
      'Details of any claims since your last renewal',
    ],
    cost: 'Depends on cover, vehicle and history.',
    processingTime: 'Usually immediate once payment clears.',
    startBefore: 21,
    penalty:
      'Driving uninsured is a serious offence in most countries, and you are personally liable for any damage you cause.',
    notes:
      "Auto-renewal is convenient but rarely the cheapest option. Get a comparison quote before you let it roll over.",
  },

  registration: {
    title: 'Renewing vehicle registration',
    authority: 'Your vehicle licensing authority',
    where: 'A licensing office or online portal.',
    bring: [
      'Current registration document',
      'Proof of valid insurance',
      'Proof of a current roadworthiness or inspection certificate, where required',
      'Proof of identity and address',
    ],
    cost: 'Typically scales with engine size, weight or vehicle value.',
    processingTime: 'Often same day in person; a few days online.',
    startBefore: 30,
    penalty: 'An unregistered vehicle can usually be impounded.',
  },

  roadworthiness: {
    title: 'Renewing a roadworthiness / inspection certificate',
    authority: 'An approved inspection centre',
    where: 'An accredited testing station.',
    bring: ['The vehicle itself', 'Current registration document', 'Your previous certificate'],
    cost: 'A fixed test fee, plus whatever repairs the test turns up.',
    processingTime: 'Usually under an hour if the vehicle passes.',
    startBefore: 21,
    penalty: 'Driving without a valid certificate is usually fineable and can void your insurance.',
    notes:
      'Book early. If the vehicle fails you will need time for repairs and a retest before the current certificate runs out.',
  },

  roadTax: {
    title: 'Renewing road tax / licence disc',
    authority: 'Your road transport or revenue authority',
    where: 'Online portal or a licensing office.',
    bring: ['Vehicle registration details', 'Proof of insurance', 'Proof of roadworthiness where required'],
    cost: 'Usually banded by engine size, emissions or weight.',
    processingTime: 'Immediate online.',
    startBefore: 21,
    penalty: 'Driving or parking on a public road untaxed usually attracts a fine.',
  },

  permit: {
    title: 'Renewing a permit',
    authority: 'The issuing authority named on the permit',
    where: 'The office that issued it.',
    bring: ['The current permit', 'Vehicle and operator details', 'Proof of identity'],
    cost: 'Varies by permit type.',
    processingTime: 'Varies.',
    startBefore: 30,
    penalty: 'Operating without a valid permit can carry fines or suspension of your operating rights.',
  },

  idp: {
    title: 'Renewing an International Driving Permit',
    authority: 'Your national motoring association',
    where: 'Usually your country’s automobile association, in person or by post.',
    bring: ['Your valid domestic driving licence', 'A passport photograph', 'Your passport'],
    cost: 'Typically a small fixed fee.',
    processingTime: 'Often issued over the counter.',
    startBefore: 30,
    penalty:
      'An IDP is only valid alongside a current domestic licence — renewing the IDP does not extend the licence itself.',
    notes: 'IDPs are normally valid for 12 months and cannot be renewed in advance in most countries.',
  },

  other: {
    title: 'Renewing this document',
    authority: 'The authority that issued it',
    where: 'Check the document itself for the issuing office.',
    bring: ['The expiring document', 'Proof of identity', 'Any supporting documents named on it'],
    cost: 'Varies.',
    processingTime: 'Varies.',
    startBefore: 30,
  },
};

/**
 * Country-specific entries. Each is merged over its generic base, so an entry
 * only needs to state what differs.
 */
const COUNTRIES = {
  Nigeria: {
    _officialUrl: 'https://www.frsc.gov.ng',
    'Driver License': {
      base: 'licence',
      authority: 'Federal Road Safety Corps (FRSC)',
      where:
        'Apply online on the FRSC portal, then attend a Vehicle Inspection Office (VIO) for biometric capture, and collect from your chosen FRSC office.',
      officialUrl: 'https://portal.frsc.gov.ng',
      bring: [
        'Your expiring licence',
        'A valid means of identification (NIN slip, passport or voter card)',
        'Your NIN',
        'Capture acknowledgement slip from the VIO',
        'Payment receipt from the portal',
      ],
      cost: 'Set nationally and periodically revised — budget roughly ₦15,000–₦25,000 depending on whether you choose 3-year or 5-year validity. Confirm the current fee on the portal before paying.',
      processingTime:
        'A temporary paper licence is usually issued at capture and is valid for 60 days; the permanent card typically takes several weeks.',
      startBefore: 60,
      penalty:
        'Driving with an expired licence is an offence under the National Road Traffic Regulations and attracts a fine plus possible vehicle impoundment.',
      notes:
        'Start early. The gap between the temporary slip and the permanent card is the part that catches people out — and only pay through the official portal.',
    },
    'Vehicle License': {
      base: 'roadTax',
      authority: 'Your State Board of Internal Revenue / Motor Licensing Authority',
      where: 'A licensing office in your state of registration, or your state’s online portal where one exists.',
      bring: ['Previous vehicle licence', 'Proof of ownership', 'Valid insurance certificate'],
      cost: 'Set per state and banded by vehicle type — commonly a few thousand naira for a private car.',
      processingTime: 'Usually same day over the counter.',
      startBefore: 30,
      penalty: 'Driving with an expired vehicle licence attracts a fine at checkpoints.',
      notes:
        'The vehicle licence, roadworthiness certificate and insurance are usually renewed together — doing them in one visit saves a trip.',
    },
    'Road Worthiness Certificate': {
      base: 'roadworthiness',
      authority: 'Vehicle Inspection Office (VIO)',
      where: 'A VIO centre in your state.',
      bring: ['The vehicle', 'Proof of ownership', 'Previous roadworthiness certificate', 'Valid insurance'],
      cost: 'A modest state-set fee, typically a few thousand naira for a private vehicle.',
      processingTime: 'Same day if the vehicle passes inspection.',
      startBefore: 21,
      penalty: 'Driving without a valid certificate attracts a fine and the vehicle can be impounded.',
    },
    'Insurance Certificate': {
      base: 'insurance',
      authority: 'A NAICOM-licensed insurer',
      officialUrl: 'https://naicom.gov.ng',
      where: 'Your insurer, a licensed broker, or the Nigerian Insurers Association portal.',
      cost:
        'Third-party motor insurance has a regulated minimum premium; comprehensive cover is priced on vehicle value.',
      notes:
        'Verify the certificate on the Nigerian Insurance Industry Database (askNIID) after you buy. Fake motor certificates are common, and an unverifiable one is worth nothing at a checkpoint or a claim.',
      penalty:
        'Third-party motor insurance is compulsory. Driving without it is an offence and leaves you personally liable for any damage you cause.',
    },
    'Vehicle Registration': {
      base: 'registration',
      authority: 'Federal Road Safety Corps / your state motor licensing authority',
      bring: ['Proof of ownership', 'Customs papers for an imported vehicle', 'Valid insurance', 'Means of identification'],
      cost: 'Varies by state and vehicle category.',
    },
    'Hackney Permit': {
      base: 'permit',
      authority: 'Your state motor licensing authority',
      where: 'A state licensing office.',
      notes: 'Required for commercial passenger vehicles. Usually renewed alongside the vehicle licence.',
    },
    'FRSC Number Plate': {
      base: 'other',
      authority: 'Federal Road Safety Corps (FRSC)',
      officialUrl: 'https://www.frsc.gov.ng',
      where: 'Through your state motor licensing authority.',
      notes:
        'Number plates are replaced rather than renewed. Apply early — production and delivery can take several weeks.',
    },
    'Change of Ownership': {
      base: 'other',
      authority: 'Your state motor licensing authority',
      notes:
        'A one-off transfer document rather than a renewable one. If yours has an expiry date, it is likely a temporary acknowledgement — follow up on the permanent record.',
    },
  },

  'United Kingdom': {
    _officialUrl: 'https://www.gov.uk',
    'Driving Licence': {
      base: 'licence',
      authority: 'DVLA',
      officialUrl: 'https://www.gov.uk/renew-driving-licence',
      where: 'Online at GOV.UK, by post, or at a Post Office that offers the service.',
      bring: [
        'Your current licence',
        'A valid UK passport (lets DVLA reuse your passport photo online)',
        'Addresses for the last three years',
        'Your National Insurance number',
      ],
      cost: 'Around £14 online, more by post. Free if you are over 70 or renewing on medical grounds.',
      processingTime: 'Usually about a week online.',
      startBefore: 60,
      penalty: 'Driving with an expired licence can attract a fine of up to £1,000.',
      notes:
        'A photocard must be renewed every 10 years even though the entitlement itself runs to age 70. After 70 it is renewed every 3 years, free of charge.',
    },
    'MOT Certificate': {
      base: 'roadworthiness',
      authority: 'DVSA-approved test centre',
      officialUrl: 'https://www.gov.uk/getting-an-mot',
      where: 'Any approved MOT test centre.',
      bring: ['The vehicle', 'Your V5C logbook (helpful but not required)'],
      cost: 'Capped at £54.85 for a car; many garages charge less.',
      processingTime: 'Usually 45–60 minutes.',
      startBefore: 30,
      penalty: 'Driving without a valid MOT can attract a £1,000 fine, and your insurance may not pay out.',
      notes:
        'You can test up to one month minus a day before expiry and keep your existing renewal date — so there is no reason to leave it late.',
    },
    'Road Tax (VED)': {
      base: 'roadTax',
      authority: 'DVLA',
      officialUrl: 'https://www.gov.uk/vehicle-tax',
      where: 'Online at GOV.UK, by phone, or at a Post Office.',
      bring: ['Your V5C reference number, or the reminder (V11)'],
      cost: 'Banded by CO₂ emissions and fuel type; electric vehicles are no longer exempt.',
      processingTime: 'Immediate online.',
      startBefore: 21,
      penalty:
        'An automatic £80 penalty, and the vehicle can be clamped. Vehicle tax does not transfer when a car is sold — the new keeper must tax it before driving.',
    },
    'Vehicle Registration (V5C)': {
      base: 'registration',
      authority: 'DVLA',
      officialUrl: 'https://www.gov.uk/vehicle-log-book',
      notes:
        'A V5C does not expire. If you have set a date here, it is probably a reminder to update your details — tell DVLA within a month of moving or changing your name, or you risk a £1,000 fine.',
    },
    'Insurance Certificate': {
      base: 'insurance',
      officialUrl: 'https://ownvehicle.askmid.com',
      notes:
        'Check your vehicle appears on the Motor Insurance Database after renewing. Continuous Insurance Enforcement means an uninsured registered vehicle is an offence even when parked off the road, unless you have declared SORN.',
    },
    'Commercial Operator License': {
      base: 'permit',
      authority: 'Traffic Commissioner',
      officialUrl: 'https://www.gov.uk/manage-vehicle-operator-licence',
      notes: 'Operator licences are subject to continuous review, not just renewal. Keep your financial standing evidence current.',
    },
  },

  Ghana: {
    _officialUrl: 'https://www.dvla.gov.gh',
    'Driver License': {
      base: 'licence',
      authority: 'Driver and Vehicle Licensing Authority (DVLA)',
      officialUrl: 'https://www.dvla.gov.gh',
      where: 'A DVLA office, or start the application on the DVLA online portal.',
      bring: ['Your expiring licence', 'Ghana Card', 'Passport photographs', 'Payment receipt'],
      cost: 'Set by the DVLA and periodically revised — confirm the current schedule on their portal.',
      processingTime: 'Biometric capture is same day; the card typically follows within a few weeks.',
      startBefore: 45,
      penalty: 'Driving with an expired licence attracts a fine.',
    },
    'Road Worthiness Certificate': {
      base: 'roadworthiness',
      authority: 'DVLA Ghana',
      where: 'A DVLA testing centre.',
      processingTime: 'Same day if the vehicle passes.',
      notes:
        'Private vehicles are generally tested annually and commercial vehicles more often. Check which applies to yours.',
    },
    'Insurance Certificate': {
      base: 'insurance',
      authority: 'An NIC-licensed insurer',
      officialUrl: 'https://nicgh.org',
      notes: 'Verify the sticker and certificate against the Motor Insurance Database.',
    },
    'Vehicle Registration': { base: 'registration', authority: 'DVLA Ghana' },
    'DVLA Number Plate': {
      base: 'other',
      authority: 'DVLA Ghana',
      notes: 'Plates are replaced rather than renewed; allow several weeks.',
    },
  },

  'South Africa': {
    _officialUrl: 'https://www.natis.gov.za',
    'Driver License': {
      base: 'licence',
      authority: 'Driving Licence Testing Centre (DLTC)',
      officialUrl: 'https://online.natis.gov.za',
      where: 'A DLTC, or book a slot online through the NaTIS portal.',
      bring: [
        'Your current licence card',
        'Your ID document',
        'Proof of residence',
        'Four black-and-white photographs (some centres take these for you)',
        'An eye test, which the centre performs',
      ],
      cost: 'A few hundred rand, set provincially.',
      processingTime:
        'Card production has historically run to several weeks or longer. Ask for a temporary licence at the same visit.',
      startBefore: 90,
      penalty: 'Driving on an expired licence is an offence and can invalidate your insurance.',
      notes:
        'You may renew from four years into the five-year validity. Backlogs are common — book as early as the system allows and take the temporary licence.',
    },
    'License Disc': {
      base: 'roadTax',
      authority: 'Your provincial licensing department',
      officialUrl: 'https://online.natis.gov.za',
      where: 'A licensing office, the Post Office, or online where your province supports it.',
      bring: ['The renewal notice (MVL2)', 'Your ID', 'Proof of residence'],
      cost: 'Banded by vehicle weight.',
      processingTime: 'Same day in person.',
      startBefore: 30,
      penalty: 'Driving with an expired disc attracts a fine; a grace period may apply but should not be relied on.',
    },
    'Roadworthy Certificate': {
      base: 'roadworthiness',
      authority: 'An accredited testing station',
      notes:
        'Generally required when a vehicle changes ownership or is re-registered, rather than annually for private cars.',
    },
    'Insurance Certificate': { base: 'insurance', authority: 'Your insurer or broker' },
    'Vehicle Registration': { base: 'registration', authority: 'Your provincial licensing department' },
  },

  'United States': {
    _officialUrl: 'https://www.usa.gov/motor-vehicle-services',
    'Driver License': {
      base: 'licence',
      authority: 'Your state DMV (or equivalent)',
      officialUrl: 'https://www.usa.gov/motor-vehicle-services',
      where: 'Your state DMV — many states allow online renewal if your photo is recent enough.',
      bring: [
        'Your current licence',
        'Proof of identity and residency',
        'Your Social Security number',
        'Payment for the renewal fee',
      ],
      cost: 'Set per state — commonly $20–$90.',
      processingTime: 'Often immediate online or over the counter, with the card by post.',
      startBefore: 45,
      penalty: 'Driving on an expired licence is a citable offence in every state.',
      notes:
        'Rules differ substantially by state — this is general guidance, so check your own DMV. If you still need a REAL ID-compliant card for domestic flights, renewing is the moment to get one.',
    },
    'Vehicle Registration': {
      base: 'registration',
      authority: 'Your state DMV',
      bring: ['Current registration', 'Proof of insurance', 'A passed emissions or safety inspection where required'],
      cost: 'Varies widely by state and vehicle.',
      notes: 'Several states require a current emissions test before they will renew registration.',
    },
    'Emissions Certificate': {
      base: 'roadworthiness',
      authority: 'A state-licensed emissions testing station',
      notes:
        'Only some states and counties require testing, and the frequency varies. Check whether yours does before booking.',
    },
    'Insurance Certificate': {
      base: 'insurance',
      notes: 'Minimum liability limits are set per state. Make sure your renewed policy still meets your state’s floor.',
    },
    'Commercial Driver License (CDL)': {
      base: 'licence',
      authority: 'Your state DMV',
      notes:
        'A CDL usually requires a current medical examiner’s certificate on file. Renewing the licence does not renew the medical card — track that date separately.',
      startBefore: 60,
    },
    'Vehicle Title': {
      base: 'other',
      authority: 'Your state DMV',
      notes: 'A title does not normally expire. If you have set a date here, it may be a lien release to follow up.',
    },
  },
};

/**
 * Map a document type to a generic base when there is no country entry.
 * Matches on the words that actually appear in the type names we offer.
 */
const inferBase = (type) => {
  // Coerce rather than rely on a default parameter: a default only fires for
  // `undefined`, and a null slipping through here would throw and take out an
  // entire notification sweep.
  const t = String(type ?? '').toLowerCase();
  if (t.includes('international driving')) return 'idp';
  if (t.includes('licence') || t.includes('license')) {
    // "Vehicle License" and "License Disc" are road tax, not a driving licence.
    if (t.includes('vehicle') || t.includes('disc')) return 'roadTax';
    return 'licence';
  }
  if (t.includes('insur')) return 'insurance';
  if (t.includes('road worth') || t.includes('roadworth') || t.includes('inspection') || t.includes('mot') || t.includes('emission'))
    return 'roadworthiness';
  if (t.includes('tax')) return 'roadTax';
  if (t.includes('regist') || t.includes('title') || t.includes('v5c')) return 'registration';
  if (t.includes('permit')) return 'permit';
  return 'other';
};

/**
 * Look up guidance for a country + document type. Always returns something
 * useful — a generic entry when we have nothing country-specific.
 */
const getGuidance = (country, type) => {
  const countryEntries = COUNTRIES[country];
  const specific = countryEntries?.[type];
  const base = GENERIC[specific?.base || inferBase(type)] || GENERIC.other;

  const merged = {
    ...base,
    ...(specific || {}),
    country: country || null,
    documentType: type || null,
    lastReviewed: LAST_REVIEWED,
    // True when this is country-specific rather than a generic fallback, so
    // the UI can be honest about how tailored the advice is.
    tailored: Boolean(specific),
  };

  merged.officialUrl = specific?.officialUrl || countryEntries?._officialUrl || base.officialUrl || null;
  delete merged.base;

  return merged;
};

module.exports = { getGuidance, GENERIC, COUNTRIES, LAST_REVIEWED, inferBase };
