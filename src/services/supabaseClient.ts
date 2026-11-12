import { createClient } from '@supabase/supabase-js';
import { browserAuthStorage } from '../utils/authStorage';
import { assertPublishableSupabaseKey } from '../utils/supabasePublishableKey';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("환경 변수가 누락되었습니다!");
}

assertPublishableSupabaseKey(supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    storage: browserAuthStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});