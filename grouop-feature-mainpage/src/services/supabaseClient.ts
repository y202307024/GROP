import { createClient } from '@supabase/supabase-js';

// .env가 안 먹히니 일단 직접 입력합니다.
const supabaseUrl = "https://orqevibktvxkyslyrnwb.supabase.co";
const supabaseAnonKey = "sb_publishable_77RZzTyTSaScSTx2_NwybA_wPdUxFfx";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);