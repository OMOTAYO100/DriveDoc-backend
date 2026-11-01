# DriveDoc — API

Express + MongoDB backend for DriveDoc. Serves the
[web app](https://github.com/OMOTAYO100/DriveDoc), which is deployed separately.

## Running locally

```bash
npm install
cp .env.example .env    # then fill it in — see the comments in that file
npm run dev             # http://localhost:5000
```

The server refuses to start without `MONGODB_URI` and `JWT_SECRET`, rather than
failing later in a way that's hard to trace.

| Command | What it does |
| --- | --- |
| `npm run dev` | nodemon with reload |
| `npm start` | Production start |
| `npm test` | Unit + integration tests (spins up an in-memory MongoDB) |

Set `NODE_ENV=development` locally. In production the auth cookie is set
`Secure` + `SameSite=None`, which `http://localhost` silently drops — so
leaving it as `production` locally makes cookie auth untestable.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/signup` | — | Create an account (requires `termsAccepted`) |
| POST | `/api/auth/login` | — | Sign in |
| POST | `/api/auth/logout` | — | Clear the auth cookie |
| POST | `/api/auth/oauth/google` | — | Sign in with a Google **credential** (ID token) |
| POST | `/api/auth/forgot-password` | — | Email a reset link |
| POST | `/api/auth/reset-password` | — | Set a new password from a token |
| GET | `/api/auth/me` | ✓ | Current user |
| PUT | `/api/auth/me` | ✓ | Update name / phone / country |
| DELETE | `/api/auth/me` | ✓ | Delete the account and all its data |
| GET | `/api/auth/me/export` | ✓ | Export everything we hold |
| GET/POST | `/api/documents` | ✓ | List / add documents |
| PUT/DELETE | `/api/documents/:id` | ✓ | Update / delete a document |
| GET | `/api/schools?lat=&lng=` or `?q=` | ✓ | Driving schools near a point or place |
| GET | `/api/guidance?country=&type=` | — | How to renew this document |
| GET | `/api/guidance/catalog` | — | Document types offered per country |
| PUT | `/api/notifications/email` | ✓ | Turn email reminders on or off |
| GET/POST | `/api/notifications/email/unsubscribe` | token | One-click unsubscribe from an email |
| GET | `/api/notifications/public-key` | — | VAPID public key |
| POST | `/api/notifications/subscribe` | ✓ | Save a push subscription |
| POST | `/api/notifications/opt-in` / `opt-out` | ✓ | Toggle reminders for a device |
| POST | `/api/jobs/notify-expiring` | secret | Run the expiry sweep |
| GET | `/api/health` | — | Health check |

Every response is JSON, including 404s, 429s and errors. The frontend reports
any non-JSON reply as a server outage, so the catch-all 404 and the error
handler at the bottom of `server.js` must stay last in the middleware chain.

The one deliberate exception is `/api/notifications/email/unsubscribe`, which
returns HTML: it is opened by a person in a browser straight from their inbox,
with no session and no JavaScript. Don't "fix" it to return JSON.

## Expiry reminders

Two channels, deliberately:

- **Push** — one notification per document, so each gets its own tag and tap target.
- **Email** — **one** message per user covering everything due, with the renewal
  guidance for each document embedded.

Email is on by default and push is opt-in, and that asymmetry is the point:
push needs a granted browser permission and, on iOS, an installed PWA. A
reminder product that only reaches users who cleared both bars is not doing its
job. Every reminder email carries a one-click unsubscribe link (plus the
`List-Unsubscribe` headers Gmail and Outlook render natively), and the
preference lives on `user.emailReminders`.

The unsubscribe link is an HMAC of the user id keyed on `JWT_SECRET` — no extra
storage, and rotating that secret invalidates every outstanding link.

`jobs/notifyExpiring.js` sweeps documents that are near or past expiry and
notifies on both channels:

- **~30 days out** — one warning, stating the real number of days.
- **final 7 days** — one per UTC day.
- **expired** — one notification, once.

Flags on each document (`monthBeforeSent`, `lastDailySentAt`, `expiredSent`)
gate **both** channels together, so the sweep is idempotent within a UTC day and
a retry re-sends neither. They reset when the expiry date changes. Dead push
subscriptions (404/410 from the push service) are pruned.

The flags are recorded even when nothing could be delivered — a user with both
channels off still gets them set. Otherwise switching a channel on later would
deliver a backlog all at once.

## Renewal guidance

`data/renewalGuidance.js` answers the question a reminder provokes: *so what do
I actually do?* It holds, per country and document type, who to renew with,
where, what to bring, rough cost, how long it takes, and what happens if you
let it lapse. The API serves it to the web app and the reminder emails embed it.

It is **editorial content, not an integration.** Fees and processes change and
vary by office, so every entry quotes costs as a range, carries an
`officialUrl` the user can check, and carries `lastReviewed`, which the UI
shows. `tailored: false` marks a generic fallback so the UI can say plainly
that it isn't country-specific.

Tailored entries exist for Nigeria, the UK, Ghana, South Africa and the US;
every other country falls back to guidance keyed on the *kind* of document.
`inferBase()` is what decides that kind, and it carries one trap worth knowing:
"Vehicle License" (Nigeria) and "License Disc" (South Africa) are road tax, not
permission to drive. Conflating them with a driving licence would give actively
wrong advice, so there is a test pinning it.

**Review the content before launch, and re-check it on a schedule.** An entry
that is confidently wrong is worse than no entry at all.

**Trigger it externally, not with `setInterval`.** An in-process timer stops
whenever the instance sleeps, restarts or deploys, and double-sends if a second
instance starts — and a reminder that silently doesn't fire is the worst failure
this product has. `render.yaml` defines an hourly cron job that calls:

```bash
curl -X POST https://drivedoc-backend.onrender.com/api/jobs/notify-expiring \
  -H "x-cron-secret: $CRON_SECRET"
```

In development only, a 60-second in-process sweep runs so the flow is
observable; set `DISABLE_DEV_SWEEP=true` to stop it.

`decideNotification(doc, now)` is a pure function with no database or network,
which is what makes the branching directly testable.

## Security notes

Things that are deliberate — please don't "simplify" them away:

- **Google sign-in verifies the ID token's audience** against
  `GOOGLE_CLIENT_ID`. The previous version accepted an *access token* and
  trusted the email behind it, which let a token issued to any other Google app
  sign in as that user. Never go back to accepting `accessToken`.
- **Document writes are field-whitelisted** (`WRITABLE_FIELDS` in
  `controllers/documentsControllers.js`). Spreading `req.body` let a client set
  `user` and move a document into someone else's account, or pre-set
  `notifications.expiredSent` to silence its own reminders.
- **`forgot-password` always returns the same response**, whether or not the
  address exists, including on error. Anything that varies turns it into an
  account-enumeration oracle.
- **Reset tokens are stored hashed**; the plain token only exists in the email
  link, and expires after an hour.
- **`/subscribe` never re-enables a subscription** the user opted out of. It
  used to force `enabled: true`, so opting out lasted until the next page load.
- **Credential endpoints have their own rate limiter** (10 per 15 min, skipping
  successful requests) separate from the general 300.
- **The general limiter returns JSON.** A string `message` is sent as HTML,
  which the frontend misreports as the backend being down.

### Rate limiting behind a proxy — verify this

`app.set("trust proxy", 1)` assumes exactly one proxy hop. The frontend reaches
the API through a Netlify rewrite, so confirm what `req.ip` actually resolves to
in production. **If it resolves to Netlify's egress address, every user shares
one rate-limit bucket** and the limit breaks the app for everyone at once. Log
`req.ip` once against the deployed service and adjust the hop count to match.

## Driving school search

DriveDoc is **a directory, not a booking service**. It lists schools from public
map data so the user can call them. Nothing is booked, nothing is charged, and
there is no confirmation step — which is why the old `pending` booking flow is
gone: it promised a confirmation nobody was there to send.

**There is no government API for this.** DVSA, FRSC, DVLA Ghana and the US state
DMVs publish registration *statistics* and FOI releases, not queryable
directories, and no such API exists in any of the supported markets. The data
comes from map providers instead.

`services/places/` holds two providers behind one interface:

- **Google Places** (`GOOGLE_PLACES_API_KEY`) — primary. Global, and crucially
  it returns phone numbers.
- **OpenStreetMap Overpass** — free fallback, used when Google is unconfigured,
  errors, or finds nothing.

Two traps worth knowing, both of which cost me a debugging round:

1. **Use Text Search, never Nearby Search.** Nearby Search matches a fixed type
   enum and there is **no `driving_school` type** in it — the Education
   category stops at school/university. Asking for it returns nothing, silently.
   Text Search matches semantically and handles a typed place name too.
2. **Overpass `out` parameters have a fixed order**: verbosity (`tags`), then
   geometry (`center`), then the limit. `out center tags 5` is a syntax error
   the server reports as a bare HTTP 500.

### Cost control

The field mask decides the billing SKU: a request bills at the highest tier any
requested field belongs to. We ask for `nationalPhoneNumber`, which is an
**Enterprise** field, so every search bills at Enterprise — **1,000 free calls
per month**, then roughly $35/1,000. That is deliberate: the user's next action
is to ring the school, and a listing with no number is useless.

Dropping to Pro fields only (displayName, formattedAddress, location,
businessStatus, googleMapsUri) would give 5,000 free calls/month but no phone
numbers. **If you outgrow the free tier, split the call** — search with Pro
fields, then fetch contact details only for the school the user taps. Twelve
results then cost one Pro call instead of twelve Enterprise ones.

Free tiers are per-SKU and no longer pool across APIs (Google replaced the flat
$200 monthly credit in March 2025).

The endpoint is defended on three sides: it requires a signed-in user, it is
rate limited to 30 searches per *user* per 15 minutes, and results are cached
in memory for 30 minutes in ~1km buckets. Don't add fields the UI doesn't
render.

The key is **server-side only**. Never move it to a `VITE_` variable; the
browser would expose it and anyone could spend your budget.


### Getting a Google Places key

1. **Create a project** at [console.cloud.google.com](https://console.cloud.google.com)
   — the project picker at the top, then *New project*. Call it `drivedoc`.

2. **Enable billing** (*Billing → Link a billing account*). A card is required
   even to use the free tier; you are not charged inside it. Without billing
   the API returns `REQUEST_DENIED` and the app silently falls back to OSM.

3. **Enable the API**: *APIs & Services → Library*, search for
   **"Places API (New)"** and enable it. Enable the **New** one — the legacy
   "Places API" is a different product and this code will not work with it.

4. **Create the key**: *APIs & Services → Credentials → Create credentials →
   API key*. Copy it.

5. **Restrict it immediately** (*Edit API key*):
   - *API restrictions* → **Restrict key** → tick **Places API (New)** only.
     A leaked unrestricted key can be spent against every Google API you have.
   - *Application restrictions* → **IP addresses**, and add your Render service's
     outbound IPs if your plan provides static ones. If it doesn't, leave this
     as None — the key never reaches a browser, so the API restriction is doing
     the real work.

6. **Cap the spend.** The budget alert only emails you; the quota is the hard
   stop:
   - *Billing → Budgets & alerts* → budget at whatever you're willing to lose.
   - *APIs & Services → Places API (New) → Quotas* → set a **requests per day**
     limit. 40/day keeps you inside the 1,000/month free allowance.

7. **Add it to the server**: Render → your service → *Environment* →
   `GOOGLE_PLACES_API_KEY`. Locally, put it in `.env`.
   **Never** add it to the frontend or name it `VITE_*`.

8. **Verify** it's actually being used — `provider` should say `google`, not `osm`:

   ```bash
   curl -s "$API/api/schools?lat=6.5244&lng=3.3792"      -H "Authorization: Bearer $TOKEN" | jq '{provider, count, warnings}'
   ```

   `"warnings": ["google-not-configured"]` means the key isn't reaching the
   server; `["google-failed"]` means it is, but Google rejected the call —
   check the server log for the reason (usually billing or API not enabled).


### Getting a Resend key (email)

Without this, password resets and every expiry reminder are written to the
server log instead of being sent. Email is the only reminder channel that
reaches every user, so this is not optional for launch.

1. **Sign up** at [resend.com](https://resend.com). No card required.

2. **Add your domain**: *Domains -> Add Domain* -> `drivedoc.org`. Resend then
   shows a set of DNS records (a DKIM `TXT`, an SPF `TXT`, and usually an `MX`
   for bounce handling).

3. **Add those records in Netlify.** `drivedoc.org` uses NS1 nameservers, which
   means Netlify DNS manages it: *Netlify -> Domains -> drivedoc.org -> DNS
   records -> Add a record*. Copy each one across exactly. There is no existing
   SPF or MX record on the domain, so nothing conflicts.

4. **Verify.** Back in Resend, hit Verify. DNS usually propagates in minutes,
   occasionally an hour.

5. **Create the key**: *API Keys -> Create*. Give it **Sending access** only —
   it never needs to read anything. It starts with `re_`, and is shown once.

6. **Set both variables** on Render:

   ```
   RESEND_API_KEY = re_...
   MAIL_FROM      = DriveDoc <noreply@drivedoc.org>
   ```

   `MAIL_FROM` must be on the domain you verified, or sending is rejected.

**Skipping verification:** `onboarding@resend.dev` sends without any domain
setup, but only ever delivers to your own Resend account address. Fine for
testing the flow, useless for real users.

**Free tier limits worth knowing:** 3,000 emails/month and **100 per day**, one
domain. Reminders are grouped into one email per user per day, so the daily cap
is roughly 100 users with something due on the same day. Comfortable at launch,
worth watching later. Sending pauses at the cap rather than silently billing
you.

### Coverage reality check

Measured against live OpenStreetMap, searching by city:

| City | Schools found | With a phone number |
| --- | --- | --- |
| Lagos | 0 | 0 |
| Abuja | 0 | 0 |
| Accra | 12 | 3 |
| Johannesburg | 7 | 0 |
| Manchester | 4 | 1 |
| London | 12 | 2 |

**OSM alone does not cover Nigeria**, and phone numbers — the entire point, since
the user's next action is to call — are missing far more often than not. Treat
the Google key as required for launch, not optional. Overpass also rate-limits
under rapid sequential load and will start returning 500s.

## Tests

```bash
npm test
```

- `jobs/notifyExpiring.test.js` — the reminder branching, as a pure function.
- `data/renewalGuidance.test.js` — every document type the app offers resolves
  to usable guidance, every tailored entry has an official source, and a
  vehicle licence is never mistaken for a driving licence.
- `test/api.test.js` — authorisation, consent recording, the reset flow, field
  whitelisting, cross-user access, slot uniqueness, opt-out persistence and the
  account-deletion cascade.
- `test/schools.test.js` — school search with both providers stubbed (these
  must never hit a paid or volunteer-run API): the Text-Search-not-Nearby-Search
  rule, fallback when Google is unconfigured or erroring, OSM ways located by
  centroid, nearest-first ordering, and that a repeat search is served from
  cache rather than re-billed.
- `test/reminders.test.js` — the guidance endpoints, email preferences, the
  unsubscribe token (including that one user's token won't unsubscribe
  another), one-email-per-user grouping, sweep idempotency, and HTML escaping
  in the email template.

All of it runs the real Express app against an in-memory MongoDB — nothing ever
touches the live Atlas cluster. The first run downloads a `mongod` binary and is
slow; later runs are not.
