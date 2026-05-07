import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  const errorMsg = 'CRITICAL CONFIG ERROR: Supabase environment variables are missing. ' +
    'Please ensure you have added VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your Secrets. ' +
    '(Note: Do NOT use NEXT_PUBLIC_ prefix, it must be VITE_)';
  console.error(errorMsg);
}

export const supabase = createClient(
  supabaseUrl || 'https://MISSING_CONFIG.supabase.co',
  supabaseAnonKey || 'MISSING_KEY'
);
