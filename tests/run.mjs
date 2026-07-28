import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { escapeHTML, localDateTime } from '../js/dom.js';

assert.equal(escapeHTML('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
assert.deepEqual(localDateTime(new Date('2026-07-29T01:30:00Z')), {
  date: '2026-07-28',
  time: '22:30:00'
});

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'O HTML não pode ter IDs duplicados.');

for (const asset of [
  '../assets/app.css',
  '../js/app.js',
  '../js/api.js',
  '../js/config.js',
  '../js/dom.js',
  '../js/storage.js',
  '../manifest.json',
  '../sw.js'
]) {
  assert.ok(fs.existsSync(new URL(asset, import.meta.url)), `Ativo ausente: ${asset}`);
}

const code = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const sandbox = {
  ContentService: {}, SpreadsheetApp: {}, PropertiesService: {},
  Utilities: {}, LockService: {}, Logger: {}
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
assert.deepEqual({ ...sandbox._dateParts('2026-07-28') }, { year: 2026, month: 7, day: 28 });
assert.equal(sandbox._dateParts('28/07/2026'), null);
assert.equal(sandbox._safeCell('=SUM(A:A)'), "'=SUM(A:A)");

console.log('DimDim: testes estáticos concluídos com sucesso.');
