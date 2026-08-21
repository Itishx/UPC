// Braino Data Bridge — the only path Braino has to this site's data.
//
// Contract (from the Braino embed playbook):
//   POST { query, page_url }  ->  { context }
// Signed with HMAC-SHA256 over the RAW body, sent as `x-braino-signature`.
//
// Read-only, and deliberately scoped: it answers about SESSIONS, PRICING and
// AGGREGATE availability. It never returns attendee names, phone numbers or
// Instagram handles — a public support bot has no business seeing those.

import crypto from 'crypto';

// Vercel must not parse the body: HMAC has to run over the exact bytes sent.
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  // Local dev shim hands us the raw string already.
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function sb(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

const INR = (n) => `₹${Number(n || 0)}`;

const EVERGREEN = [
  'Unplug Collective is a community of open mics, songwriters\' circles and acoustic sessions.',
  'The idea: music deserves to be heard. Intimate rooms where musicians perform authentically and listeners genuinely listen. No competitions, no distractions, no filters.',
  'How a session works: sign-ups open thirty minutes before the first set, first come first served. Each performer gets a fifteen-minute slot — two or three songs, unplugged. Covers, originals and half-finished ideas are all welcome. There are no auditions.',
  'Two ways to book: Performer (₹299) gets a slot on the mic, a sound check before doors, and photos from the night. Listener (₹199) gets entry to the full session and reserved seating.',
  'Booking happens on the site itself, in the "Book your spot" section.',
].join('\n');

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const SECRET = process.env.BRAINO_BRIDGE_SECRET;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const raw = await readRawBody(req);

  // --- verify the call really came from Braino -----------------------------
  if (!SECRET) {
    res.status(500).json({ error: 'Bridge secret not configured' });
    return;
  }

  const signature = req.headers['x-braino-signature'] || '';
  const expected = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

  const sigBuf = Buffer.from(String(signature), 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    res.status(401).json({ error: 'bad signature' });
    return;
  }

  // --- build context -------------------------------------------------------
  let query = '';
  try {
    ({ query = '' } = JSON.parse(raw));
  } catch {
    res.status(400).json({ error: 'bad json' });
    return;
  }

  const q = String(query).toLowerCase();

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      res.status(200).json({ context: EVERGREEN });
      return;
    }

    const sessions = await sb(
      SUPABASE_URL, SERVICE_KEY,
      'sessions?select=volume_number,title,event_date,venue,city,performer_price,listener_price,capacity,is_open&order=volume_number.desc'
    );

    const parts = [EVERGREEN];
    const upcoming = sessions.find((s) => s.is_open);

    if (upcoming) {
      parts.push(
        `Next session: ${upcoming.title} — Volume ${upcoming.volume_number}, on ${upcoming.event_date}` +
        `${upcoming.venue ? `, at ${upcoming.venue}` : ''}${upcoming.city ? `, ${upcoming.city}` : ''}. ` +
        `Performer ${INR(upcoming.performer_price)}, listener ${INR(upcoming.listener_price)}.`
      );

      // Aggregate availability only — counts, never who booked.
      const wantsAvailability = /spot|seat|avail|full|sold|book|left|capacity|how many/.test(q);
      if (wantsAvailability && upcoming.capacity) {
        const rows = await sb(
          SUPABASE_URL, SERVICE_KEY,
          `registrations?select=id&volume_number=eq.${upcoming.volume_number}`
        );
        const taken = rows.length;
        const left = Math.max(0, upcoming.capacity - taken);
        parts.push(
          left > 0
            ? `Availability for Volume ${upcoming.volume_number}: about ${left} of ${upcoming.capacity} spots still open.`
            : `Volume ${upcoming.volume_number} is currently full (${upcoming.capacity} spots).`
        );
      }
    } else {
      parts.push('There is no session open for booking right now.');
    }

    if (/past|previous|history|before|last|volume|how many session/.test(q)) {
      const past = sessions.filter((s) => !s.is_open);
      if (past.length) {
        parts.push(
          'Past sessions: ' +
          past.map((s) => `Volume ${s.volume_number} on ${s.event_date}${s.venue ? ` at ${s.venue}` : ''}`).join('; ') +
          `. That's ${sessions.length} volumes in total so far.`
        );
      }
    }

    res.status(200).json({ context: parts.join('\n') });
  } catch (err) {
    console.error('[braino-bridge]', err);
    // Never guess — an empty-ish context is better than a wrong one.
    res.status(200).json({ context: EVERGREEN });
  }
}
