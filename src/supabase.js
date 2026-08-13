import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env');
}

// The anon key is safe in the browser: Row Level Security decides what it can do.
// Per schema.sql it can read `sessions` and insert into `registrations`, nothing else.
export const supabase = createClient(url, anonKey);

export const CURRENT_VOLUME = 6;
