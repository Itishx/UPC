// Vercel serverless function.
// The service role key lives here — on the server — never in the browser bundle.

async function sb(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  // Read env inside the handler so it works both on Vercel and in local dev,
  // where the vars are injected after this module is first imported.
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMIN_ANSWER = (process.env.ADMIN_ANSWER || process.env.VITE_ADMIN_ANSWER || 'iti').toLowerCase();

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const answer = String(body?.answer ?? '').trim().toLowerCase();
  if (answer !== ADMIN_ANSWER) {
    res.status(401).json({ error: 'Wrong answer.' });
    return;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.status(500).json({ error: 'Server is missing Supabase credentials.' });
    return;
  }

  try {
    const [registrations, sessions] = await Promise.all([
      sb(SUPABASE_URL, SERVICE_KEY, 'registrations?select=*&order=created_at.desc'),
      sb(SUPABASE_URL, SERVICE_KEY, 'sessions?select=*&order=volume_number.desc'),
    ]);
    res.status(200).json({ registrations, sessions });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
