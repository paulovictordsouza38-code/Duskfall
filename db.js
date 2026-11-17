// Armazenamento das contas.
//  - Se existir a variavel DATABASE_URL (Postgres, ex.: Neon/Supabase/Render Postgres): usa o banco (nao perde nada).
//  - Senao: arquivo JSON em DATA_DIR (padrao ./data). No Render gratis esse arquivo some quando o servidor reinicia.
'use strict';
const fs = require('fs');
const path = require('path');

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'contas.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { data = {}; }
  let timer = null;
  function flush() {
    timer = null;
    try { fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); } catch (e) { console.error('Falha ao salvar contas:', e.message); }
  }
  return {
    kind: 'arquivo (' + file + ')',
    async get(key) { return data[key] ? JSON.parse(JSON.stringify(data[key])) : null; },
    async put(key, acc) { data[key] = JSON.parse(JSON.stringify(acc)); if (!timer) timer = setTimeout(flush, 300); },
    async create(key, acc) { if (data[key]) return false; data[key] = JSON.parse(JSON.stringify(acc)); if (!timer) timer = setTimeout(flush, 300); return true; },
    async count() { return Object.keys(data).length; },
    close() { if (timer) { clearTimeout(timer); flush(); } },
  };
}

async function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 4 });
  await pool.query('CREATE TABLE IF NOT EXISTS contas (chave TEXT PRIMARY KEY, dados JSONB NOT NULL, criada TIMESTAMPTZ DEFAULT now())');
  return {
    kind: 'Postgres',
    async get(key) { const r = await pool.query('SELECT dados FROM contas WHERE chave=$1', [key]); return r.rows[0] ? r.rows[0].dados : null; },
    async put(key, acc) { await pool.query('INSERT INTO contas(chave,dados) VALUES($1,$2) ON CONFLICT (chave) DO UPDATE SET dados=$2', [key, JSON.stringify(acc)]); },
    async create(key, acc) { const r = await pool.query('INSERT INTO contas(chave,dados) VALUES($1,$2) ON CONFLICT (chave) DO NOTHING', [key, JSON.stringify(acc)]); return r.rowCount === 1; },
    async count() { const r = await pool.query('SELECT count(*)::int AS n FROM contas'); return r.rows[0].n; },
    close() { pool.end().catch(() => {}); },
  };
}

async function openStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try { return await pgStore(url); } catch (e) { console.error('ERRO ao abrir o Postgres (' + e.message + '). Usando arquivo local.'); }
  }
  return fileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
}

module.exports = { openStore, fileStore };
