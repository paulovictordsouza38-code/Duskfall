// Contas com senha. Senha: scrypt + sal individual (nunca guardada em texto). Sessao: token aleatorio (so o hash fica no banco).
'use strict';
const crypto = require('crypto');

const NAME_RE = /^[A-Za-z0-9_ .\-]{3,16}$/;
const MAX_TOKENS = 6;
const MAX_FRIENDS = 100;

function scrypt(pass, salt) {
  return new Promise((res, rej) => crypto.scrypt(pass, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();

function createAuth(store) {
  const fails = new Map();                       // ip -> { n, until }
  function limited(ip) { const f = fails.get(ip); return !!(f && f.until > Date.now() && f.n >= 8); }
  function fail(ip) {
    const now = Date.now();
    let f = fails.get(ip);
    if (!f || f.until < now) f = { n: 0, until: now + 5 * 60 * 1000 };
    f.n++; fails.set(ip, f);
  }
  setInterval(() => { const now = Date.now(); for (const [k, f] of fails) if (f.until < now) fails.delete(k); }, 60000).unref();

  function pub(acc, token) { return { t: 'authok', name: acc.name, token, skin: acc.skin | 0, friends: acc.friends || [] }; }
  async function newSession(acc) {
    const token = crypto.randomBytes(32).toString('hex');
    acc.tokens = (acc.tokens || []).concat(sha(token)).slice(-MAX_TOKENS);
    acc.last = Date.now();
    await store.put(keyOf(acc.name), acc);
    return token;
  }

  return {
    /** devolve { err } ou { acc, reply } */
    async register(ip, m) {
      if (limited(ip)) return { err: 'Muitas tentativas. Espere alguns minutos.' };
      const name = String(m.name || '').trim().replace(/\s+/g, ' ');
      const pass = String(m.pass || '');
      if (!NAME_RE.test(name)) return { err: 'Nome: 3 a 16 letras, números ou _' };
      if (pass.length < 4 || pass.length > 64) return { err: 'Senha: de 4 a 64 caracteres' };
      const salt = crypto.randomBytes(16);
      const hash = await scrypt(pass, salt);
      const acc = { name, salt: salt.toString('hex'), hash: hash.toString('hex'), skin: m.skin === 1 ? 1 : 0, friends: [], tokens: [], created: Date.now() };
      const ok = await store.create(keyOf(name), acc);
      if (!ok) { fail(ip); return { err: 'Esse nome já existe. Entre com a senha ou escolha outro.' }; }
      const token = await newSession(acc);
      return { acc, reply: pub(acc, token) };
    },
    async login(ip, m) {
      if (limited(ip)) return { err: 'Muitas tentativas. Espere alguns minutos.' };
      const name = String(m.name || '').trim();
      const acc = NAME_RE.test(name) ? await store.get(keyOf(name)) : null;
      const pass = String(m.pass || '').slice(0, 64);
      if (!acc) { await scrypt(pass, Buffer.alloc(16)); fail(ip); return { err: 'Nome ou senha incorretos' }; }
      const h = await scrypt(pass, Buffer.from(acc.salt, 'hex'));
      if (!crypto.timingSafeEqual(h, Buffer.from(acc.hash, 'hex'))) { fail(ip); return { err: 'Nome ou senha incorretos' }; }
      const token = await newSession(acc);
      return { acc, reply: pub(acc, token) };
    },
    async resume(ip, m) {
      if (limited(ip)) return { err: 'Muitas tentativas. Espere alguns minutos.', soft: true };
      const name = String(m.name || '').trim();
      const token = String(m.token || '');
      const acc = NAME_RE.test(name) && /^[0-9a-f]{64}$/.test(token) ? await store.get(keyOf(name)) : null;
      if (!acc || !(acc.tokens || []).includes(sha(token))) { fail(ip); return { err: 'Sessão expirada. Entre de novo.' }; }
      acc.last = Date.now();
      await store.put(keyOf(acc.name), acc);
      return { acc, reply: pub(acc, token) };
    },
    async logout(acc0, token) {
      const acc = (await store.get(keyOf(acc0.name))) || acc0;
      acc.tokens = (acc.tokens || []).filter((x) => x !== sha(String(token || '')));
      await store.put(keyOf(acc.name), acc);
    },
    async prefs(acc0, m) {
      const acc = (await store.get(keyOf(acc0.name))) || acc0;
      if (m.skin === 0 || m.skin === 1) acc.skin = m.skin;
      if (Array.isArray(m.friends)) acc.friends = m.friends.map((x) => String(x).slice(0, 16)).filter(Boolean).slice(0, MAX_FRIENDS);
      await store.put(keyOf(acc.name), acc);
    },
  };
}

module.exports = { createAuth, keyOf, NAME_RE };
