import { createClient } from '@supabase/supabase-js';
import { browserAuthStorage } from './utils/authStorage';
import { assertPublishableSupabaseKey } from './utils/supabasePublishableKey';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Supabase env가 설정되지 않았습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 .env(.env.local)에 설정하세요.');
}

assertPublishableSupabaseKey(supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // 브라우저를 닫으면 세션이 사라지게 sessionStorage를 기본으로 씁니다.
    storage: browserAuthStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});