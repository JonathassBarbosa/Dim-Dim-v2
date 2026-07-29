export const STORAGE_KEYS = {
  catalog: 'dd_catalog',
  saldoVisivel: 'dd_saldo_visivel',
  supabaseUrl: 'dd_supabase_url',
  supabaseAnonKey: 'dd_supabase_anon_key',
  supabaseSession: 'dd_supabase_session',
  aiVoice: 'dd_ai_voice'
};

export const GROUPS = ['Necessidade', 'Desejo', 'Investimento'];

// Estes dois valores são públicos por projeto. A segurança dos dados é feita
// pelo login e pelas políticas RLS do PostgreSQL, nunca ocultando a anon key.
export const SUPABASE_URL = 'https://bpoyfqojlhztqprpndla.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_UIxdPTKyVTl5Cy9up7s3Zw_z2QMiWXT';

// Chave pública Web Push. A chave privada correspondente fica somente nos
// Secrets da Edge Function do Supabase.
export const VAPID_PUBLIC_KEY = 'BHbbAI49ZHYN2Zj-3oLcQZ31fdiSbTJKC4ZkEqhaSJhbxFKvHvIso1rfrWe-AXUBG3dlyHzTXfuas9dshdKb-v0';
