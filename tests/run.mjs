import fs from 'node:fs';
import assert from 'node:assert/strict';
import { escapeHTML, localDateTime } from '../js/dom.js';
import { apiErrorMessage } from '../js/api.js';

assert.equal(escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
assert.deepEqual(localDateTime(new Date('2026-07-29T01:30:00Z')), {
  date: '2026-07-28',
  time: '22:30:00'
});
assert.equal(
  apiErrorMessage({ error: { message: 'Limite da API excedido.' } }, 429),
  'Limite da API excedido.'
);
assert.equal(apiErrorMessage(null, 503), 'Falha no servidor (HTTP 503).');

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const frontend = [
  html,
  fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8')
].join('\n');
assert.doesNotMatch(frontend, /(?:AIza|AQ\.)[A-Za-z0-9._-]{20,}/, 'O frontend não pode conter chave de API.');
assert.doesNotMatch(frontend, /generativelanguage\.googleapis\.com/, 'O frontend não deve chamar o Gemini diretamente.');
assert.doesNotMatch(frontend, /script\.google\.com/, 'O frontend não deve depender do Apps Script.');
assert.doesNotMatch(frontend, /@mlc-ai\/web-llm/, 'O frontend não deve baixar um modelo local pesado.');
assert.doesNotMatch(frontend, /Baixando modelo local/, 'O assistente deve usar o backend Gemini.');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'O HTML não pode ter IDs duplicados.');

for (const asset of [
  '../assets/app.css',
  '../js/app.js',
  '../js/api.js',
  '../js/config.js',
  '../js/dom.js',
  '../js/notifications.js',
  '../js/storage.js',
  '../manifest.json',
  '../sw.js'
]) {
  assert.ok(fs.existsSync(new URL(asset, import.meta.url)), `Ativo ausente: ${asset}`);
}

const schema = fs.readFileSync(new URL('../supabase/migrations/202607280001_initial_schema.sql', import.meta.url), 'utf8');
for (const table of [
  'profiles', 'accounts', 'credit_cards', 'credit_card_invoices', 'categories',
  'transactions', 'transaction_items', 'installments', 'recurring_expenses',
  'budgets', 'income_sources', 'investments', 'shopping_list_items', 'receipts',
  'audit_logs', 'user_settings'
]) {
  assert.match(schema, new RegExp(`create table public\\.${table}\\b`), `Tabela ausente: ${table}`);
  assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`), `RLS ausente: ${table}`);
}
assert.match(schema, /create policy "own rows only"/);
assert.match(schema, /storage\.buckets/);

const notificationSchema = fs.readFileSync(
  new URL('../supabase/migrations/202607290001_notifications.sql', import.meta.url),
  'utf8'
);
for (const table of [
  'notification_preferences', 'notifications', 'push_subscriptions', 'financial_goals'
]) {
  assert.match(notificationSchema, new RegExp(`create table public\\.${table}\\b`), `Tabela ausente: ${table}`);
  assert.match(notificationSchema, new RegExp(`alter table public\\.${table} enable row level security`), `RLS ausente: ${table}`);
}
assert.match(notificationSchema, /create or replace function public\.financial_summary\(\)/);
assert.match(notificationSchema, /create or replace function public\.generate_financial_notifications\(\)/);

const edgeFunction = fs.readFileSync(new URL('../supabase/functions/gemini/index.ts', import.meta.url), 'utf8');
assert.match(edgeFunction, /Deno\.env\.get\('GEMINI_API_KEY'\)/);
assert.doesNotMatch(edgeFunction, /AIza[A-Za-z0-9_-]{20,}/);

const notificationFunction = fs.readFileSync(
  new URL('../supabase/functions/notification-dispatch/index.ts', import.meta.url),
  'utf8'
);
assert.match(notificationFunction, /Deno\.env\.get\('VAPID_PRIVATE_KEY'\)/);
assert.match(notificationFunction, /Deno\.env\.get\('CRON_SECRET'\)/);
assert.match(notificationFunction, /buildPushHTTPRequest/);
assert.doesNotMatch(notificationFunction, /npm:web-push/);
assert.doesNotMatch(frontend, /VAPID_PRIVATE_KEY/);

const serviceWorker = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(serviceWorker, /addEventListener\('push'/);
assert.match(serviceWorker, /addEventListener\('notificationclick'/);

console.log('DimDim: testes estáticos concluídos com sucesso.');
