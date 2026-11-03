// Teste de partidas: node teste_partida.mjs  (solo, duo vs duo, squad, 40 jogadores, fim por tempo)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { server, matches } = require('./server.js');
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const open = () => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port);
  const q = []; let waiter = null;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (waiter && (!waiter.t || waiter.t === m.t)) { const w = waiter; waiter = null; w.r(m); } else q.push(m); };
  const next = (t) => new Promise((r2) => { const i = q.findIndex((m) => !t || m.t === t); if (i >= 0) return r2(q.splice(i, 1)[0]); waiter = { t, r: r2 }; });
  ws.onopen = async () => { const c = { ws, next, q, send: (o) => ws.send(JSON.stringify(o)) }; await next('hello'); res(c); };
});
// solo: dois jogadores caem na mesma partida
const s1 = await open(); s1.send({ t: 'quick', name: 'Sol1' }); const m1 = await s1.next('match'); assert.equal(m1.teams, 1);
const s2 = await open(); s2.send({ t: 'quick', name: 'Sol2' }); const m2 = await s2.next('match'); assert.equal(m2.teams, 2); assert.equal(m2.players.length, 2);
const j = await s1.next('mjoin'); assert.equal(j.teams, 2); console.log('ok solo: segundo jogador entra e o primeiro e avisado');
// estado e snapshot
s1.send({ t: 'st', x: 1.234, y: 0, z: -3, yaw: 0.5, w: 'mp5', s: 2, cr: 0, a: 1 });
const sn = await s2.next('snap'); assert.equal(sn.p.find((p) => p.id === m1.you).x, 1.23); console.log('ok snapshot');
// dano: inimigo sim, mesmo time nao
s1.send({ t: 'hit', to: m2.you, dmg: 36 }); const h = await s2.next('hit'); assert.equal(h.dmg, 36); console.log('ok dano em inimigo');
s2.send({ t: 'dead', by: m1.you }); const f = await s1.next('feed'); assert.equal(f.kills, 1); console.log('ok abate contado');
s1.send({ t: 'ev', k: 'shot', d: { a: [0, 1, 0], b: [1, 1, 1] } }); const ev = await s2.next('ev'); assert.equal(ev.k, 'shot'); console.log('ok evento de tiro');
// duo: grupo de 2 entra junto como um time; limite do grupo
const a = await open(); a.send({ t: 'create', name: 'Ana', mode: 'duo' }); const ja = await a.next('joined');
const b = await open(); b.send({ t: 'join', code: ja.code, name: 'Beto' }); await b.next('joined');
const c = await open(); c.send({ t: 'join', code: ja.code, name: 'Caio' }); assert.match((await c.next('error')).msg, /cheia/); console.log('ok duo limita em 2');
a.send({ t: 'start' }); const ma = await a.next('match'); const mb = await b.next('match'); assert.equal(ma.team, mb.team);
b.send({ t: 'hit', to: ma.you, dmg: 50 }); await new Promise((r) => setTimeout(r, 80)); assert.equal(a.q.filter((m) => m.t === 'hit').length, 0); console.log('ok duo: sem fogo amigo, mesmo time');
// squad com 5 e anfitriao
const sq = await open(); sq.send({ t: 'create', name: 'H', mode: 'squad' }); const js = await sq.next('joined');
const mem = []; for (let i = 0; i < 4; i++) { const x = await open(); x.send({ t: 'join', code: js.code, name: 'M' + i }); await x.next('joined'); mem.push(x); }
const x6 = await open(); x6.send({ t: 'join', code: js.code, name: 'extra' }); assert.match((await x6.next('error')).msg, /cheia/);
mem[0].send({ t: 'start' }); assert.match((await mem[0].next('error')).msg, /anfitriao/);
sq.send({ t: 'start' }); const ms = await sq.next('match'); assert.equal(ms.mode, 'squad'); assert.equal(ms.players.length, 5); console.log('ok squad de 5, so o anfitriao inicia');
// 40 jogadores no maximo por partida
const many = [];
for (let i = 0; i < 41; i++) { const x = await open(); x.send({ t: 'quick', name: 'P' + i }); many.push(x); }
await new Promise((r) => setTimeout(r, 300));
const sizes = [...matches.values()].filter((m) => m.mode === 'solo').map((m) => m.players.size);
assert.ok(sizes.every((n) => n <= 40), JSON.stringify(sizes)); assert.ok(sizes.length >= 2); console.log('ok maximo 40 por partida:', sizes.join(','));
// fim por tempo
const mt = [...matches.values()].find((m) => m.mode === 'squad'); mt.endsAt = Date.now() + 50;
const end = await sq.next('mend'); assert.equal(end.scores.length, 5); console.log('ok fim da partida com placar');
console.log('TODOS OS TESTES DE PARTIDA PASSARAM'); process.exit(0);
