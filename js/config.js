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
