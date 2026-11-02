// node teste_amigos.mjs : busca por nome, pedido de amizade, presenca e convite
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { server } = require('./server.js');
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const open = () => new Promise((res) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port); const q = []; let w = null;
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (w && (!w.t || w.t === m.t)) { const x = w; w = null; x.r(m); } else q.push(m); };
  const next = (t) => new Promise((r2) => { const i = q.findIndex((m) => !t || m.t === t); if (i >= 0) return r2(q.splice(i, 1)[0]); w = { t, r: r2 }; });
  ws.onopen = async () => { const c = { next, send: (o) => ws.send(JSON.stringify(o)) }; await next('hello'); res(c); };
});
const a = await open(); a.send({ t: 'login', name: 'Carlos' }); await a.next('login');
const b = await open(); b.send({ t: 'login', name: 'Marcela' }); const lb = await b.next('login');
a.send({ t: 'search', q: 'marc' }); const f = await a.next('found'); assert.equal(f.list[0].name, 'Marcela'); console.log('ok busca por nome (sem diferenciar maiuscula)');
a.send({ t: 'freq', to: f.list[0].id }); const rq = await b.next('freq'); assert.equal(rq.from, 'Carlos');
b.send({ t: 'facc', to: rq.fid }); assert.equal((await a.next('friend')).name, 'Marcela'); assert.equal((await b.next('friend')).name, 'Carlos'); console.log('ok pedido e aceite de amizade');
a.send({ t: 'who', names: ['marcela', 'fulano'] }); const on = await a.next('online'); assert.equal(on.list.length, 1); console.log('ok presenca: so quem esta online');
a.send({ t: 'create', name: 'Carlos', mode: 'duo' }); const j = await a.next('joined');
a.send({ t: 'invite', to: lb.id }); const inv = await b.next('invite'); assert.equal(inv.code, j.code); console.log('ok convite para o grupo');
b.send({ t: 'join', code: inv.code, name: 'Marcela' }); assert.equal((await b.next('joined')).players.length, 2); console.log('ok amigo entrou pelo convite');
const res = await fetch('http://127.0.0.1:' + port + '/health'); assert.match(await res.text(), /^ok salas-3/);
console.log('TODOS OS TESTES DE AMIGOS PASSARAM'); process.exit(0);
