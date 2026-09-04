import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase env가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 .env(.env.local)에 설정하세요.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);