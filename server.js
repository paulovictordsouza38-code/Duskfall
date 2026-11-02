// Servidor de salas por codigo. SEM dependencias: WebSocket implementado na mao (http + crypto).
// Rodar:  node server.js   (usa a porta da variavel PORT; local: 8787)
'use strict';
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 8787;
const VERSION = 'salas-3';
const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const online = new Map();                                // id -> cliente (presenca para busca de amigos)
const MAX_PLAYERS = 5;                                 // tamanho maximo de um grupo (squad)
const PARTY_MAX = { solo: 1, duo: 2, squad: 5 };
const MATCH_MAX = 40;                                  // jogadores por partida
const MATCH_MS = 10 * 60 * 1000;                       // 10 minutos
const matches = new Map();                             // id -> partida
const ROOM_IDLE_MS = 10 * 60 * 1000;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';           // sem I e O (confundem com 1 e 0)

const rooms = new Map();                               // codigo -> { code, players: Map(id->client), hostId, state, created }
let nextId = 1;

// ------------------------------------------------------------------ WebSocket (RFC 6455, o necessario)
function acceptKey(key) { return crypto.createHash('sha1').update(key + GUID).digest('base64'); }

function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.id = String(nextId++);
    this.name = 'Jogador';
    this.room = null;
    this.match = null;
    this.team = null;
    this.st = null;
    this.kills = 0;
    this.deaths = 0;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.alive = true;
    this.lastMsg = Date.now();
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.socket.destroy());
    socket.setNoDelay(true);
    online.set(this.id, this);
  }
  send(obj) {
    if (!this.alive || this.socket.destroyed) return;
    try { this.socket.write(frame(1, Buffer.from(JSON.stringify(obj)))); } catch (e) { /* conexao caiu */ }
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > 1 << 20) { this.socket.destroy(); return; }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (!masked) { this.socket.destroy(); return; }       // cliente tem que mascarar
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.onFrame(fin, op, data);
    }
  }
  onFrame(fin, op, data) {
    if (op === 8) { try { this.socket.write(frame(8, Buffer.alloc(0))); } catch (e) { /* ok */ } this.socket.end(); return; }
    if (op === 9) { try { this.socket.write(frame(10, data)); } catch (e) { /* ok */ } return; }
    if (op === 10) return;
    if (op === 1 || op === 0) {
      this.frag.push(data);
      if (!fin) return;
      const text = Buffer.concat(this.frag).toString('utf8');
      this.frag = [];
      this.lastMsg = Date.now();
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (msg && typeof msg === 'object') handle(this, msg);
    }
  }
  onClose() {
    this.alive = false;
    online.delete(this.id);
    leaveMatch(this);
    leaveRoom(this);
  }
}

// ------------------------------------------------------------------ salas
function cleanName(n) {
  const s = String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return s || 'Jogador';
}
function newCode() {
  for (let k = 0; k < 200; k++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETTERS[crypto.randomInt(LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function listPlayers(room) {
  return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, host: p.id === room.hostId }));
}
function broadcast(room, obj, exceptId = null) {
  for (const p of room.players.values()) if (p.id !== exceptId) p.send(obj);
}
function sendPlayers(room) {
  broadcast(room, { t: 'players', code: room.code, state: room.state, players: listPlayers(room) });
}
function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.players.delete(c.id);
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.hostId === c.id) room.hostId = room.players.values().next().value.id;   // o proximo vira anfitriao
  room.touched = Date.now();
  broadcast(room, { t: 'left', id: c.id });
  sendPlayers(room);
}

// ------------------------------------------------------------------ partidas (ate 40 jogadores, 10 min)
let nextMatch = 1;
function matchList(mt) { return [...mt.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team })); }
function mbroadcast(mt, obj, exceptId = null) { for (const p of mt.players.values()) if (p.id !== exceptId) p.send(obj); }
function joinMatch(mode, members, team) {
  let mt = null;
  for (const x of matches.values()) if (x.mode === mode && x.players.size + members.length <= MATCH_MAX && x.endsAt - Date.now() > 20000) { mt = x; break; }
  if (!mt) {
    mt = { id: 'M' + nextMatch++, mode, players: new Map(), endsAt: Date.now() + MATCH_MS };
    matches.set(mt.id, mt);
  }
  for (const p of members) { p.match = mt; p.team = team; p.kills = 0; p.deaths = 0; p.st = null; mt.players.set(p.id, p); }
  const teams = new Set([...mt.players.values()].map((p) => p.team));
  for (const p of members) p.send({ t: 'match', id: mt.id, you: p.id, team, mode, left: mt.endsAt - Date.now(), players: matchList(mt), teams: teams.size });
  const others = [...mt.players.values()].filter((p) => !members.includes(p));
  for (const p of others) p.send({ t: 'mjoin', players: members.map((q) => ({ id: q.id, name: q.name, team })), teams: teams.size });
  return mt;
}
function leaveMatch(c) {
  const mt = c.match;
  if (!mt) return;
  c.match = null;
  mt.players.delete(c.id);
  if (mt.players.size === 0) { matches.delete(mt.id); return; }
  mbroadcast(mt, { t: 'mleft', id: c.id });
}
function scores(mt) {
  return [...mt.players.values()].map((p) => ({ id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths })).sort((a, b) => b.kills - a.kills);
}
setInterval(() => {                                   // snapshots 10x por segundo + fim de partida
  const now = Date.now();
  for (const mt of matches.values()) {
    if (now >= mt.endsAt) {
      mbroadcast(mt, { t: 'mend', scores: scores(mt) });
      for (const p of mt.players.values()) { p.match = null; p.team = null; }
      matches.delete(mt.id);
      continue;
    }
    if (mt.players.size < 2) continue;
    const snap = [];
    for (const p of mt.players.values()) if (p.st) snap.push({ id: p.id, ...p.st });
    if (snap.length) mbroadcast(mt, { t: 'snap', p: snap });
  }
}, 100).unref();

function handle(c, m) {
  switch (m.t) {
    case 'login': c.name = cleanName(m.name); c.send({ t: 'login', id: c.id, name: c.name, online: online.size }); break;
    case 'search': {   // procura jogadores conectados pelo nome
      const q = String(m.q || '').trim().toLowerCase().slice(0, 16);
      if (q.length < 2) { c.send({ t: 'found', q, list: [] }); break; }
      const list = [];
      for (const p of online.values()) if (p !== c && p.name.toLowerCase().includes(q)) { list.push({ id: p.id, name: p.name }); if (list.length >= 10) break; }
      c.send({ t: 'found', q, list });
      break;
    }
    case 'freq': { const to = online.get(String(m.to)); if (to && to !== c) { to.send({ t: 'freq', from: c.name, fid: c.id }); c.send({ t: 'sent', name: to.name }); } else c.send({ t: 'error', msg: 'Jogador saiu' }); break; }
    case 'facc': { const to = online.get(String(m.to)); if (to) { to.send({ t: 'friend', name: c.name, id: c.id }); c.send({ t: 'friend', name: to.name, id: to.id }); } break; }
    case 'who': {      // quais dos nomes estao online agora
      const names = new Set((Array.isArray(m.names) ? m.names : []).slice(0, 100).map((n) => String(n).toLowerCase()));
      const on = [];
      for (const p of online.values()) if (names.has(p.name.toLowerCase())) on.push({ id: p.id, name: p.name, busy: !!p.match });
      c.send({ t: 'online', list: on });
      break;
    }
    case 'invite': {   // convida um amigo para a sala em que estou
      const to = online.get(String(m.to));
      if (to && c.room) to.send({ t: 'invite', from: c.name, code: c.room.code, mode: c.room.mode });
      break;
    }
    case 'ping': c.send({ t: 'pong', ts: m.ts || 0 }); break;
    case 'create': {
      if (c.room) leaveRoom(c);
      c.name = cleanName(m.name);
      const code = newCode();
      if (!code) { c.send({ t: 'error', msg: 'Servidor cheio, tente de novo' }); break; }
      const mode = PARTY_MAX[m.mode] ? m.mode : 'duo';
      const room = { code, mode, players: new Map(), hostId: c.id, state: 'lobby', created: Date.now(), touched: Date.now() };
      room.players.set(c.id, c);
      c.room = room;
      rooms.set(code, room);
      c.send({ t: 'joined', id: c.id, code, host: true, mode, players: listPlayers(room) });
      break;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) { c.send({ t: 'error', msg: 'Sala ' + (code || '????') + ' nao existe' }); break; }
      if (room.state !== 'lobby') { c.send({ t: 'error', msg: 'A partida ja comecou' }); break; }
      const cap = PARTY_MAX[room.mode] || MAX_PLAYERS;
      if (room.players.size >= cap) { c.send({ t: 'error', msg: 'Sala cheia (' + cap + ' no ' + room.mode + ')' }); break; }
      if (c.room) leaveRoom(c);
      c.name = cleanName(m.name);
      room.players.set(c.id, c);
      c.room = room;
      room.touched = Date.now();
      c.send({ t: 'joined', id: c.id, code, host: room.hostId === c.id, mode: room.mode, players: listPlayers(room) });
      sendPlayers(room);
      break;
    }
    case 'leave': leaveRoom(c); c.send({ t: 'left', id: c.id, self: true }); break;
    case 'start': {
      const room = c.room;
      if (!room) break;
      if (room.hostId !== c.id) { c.send({ t: 'error', msg: 'So o anfitriao inicia a partida' }); break; }
      room.state = 'playing';
      room.touched = Date.now();
      broadcast(room, { t: 'start', code: room.code, players: listPlayers(room) });
      joinMatch(room.mode, [...room.players.values()], room.code);
      break;
    }
    case 'quick': {   // solo: entra direto numa partida (cada um e seu proprio time)
      c.name = cleanName(m.name);
      leaveMatch(c);
      joinMatch('solo', [c], 'S' + c.id);
      break;
    }
    case 'unmatch': leaveMatch(c); break;
    case 'st': {      // estado do jogador (posicao, mira, arma)
      if (!c.match) break;
      const n = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
      c.st = { x: n(m.x), y: n(m.y), z: n(m.z), yaw: n(m.yaw), w: typeof m.w === 'string' ? m.w.slice(0, 8) : null, s: n(m.s), cr: n(m.cr), a: m.a ? 1 : 0 };
      break;
    }
    case 'ev': {      // tiro / granada / barril: reenvia para os outros da partida
      if (!c.match) break;
      const d = m.d && typeof m.d === 'object' ? m.d : {};
      mbroadcast(c.match, { t: 'ev', from: c.id, k: String(m.k || '').slice(0, 8), d }, c.id);
      break;
    }
    case 'hit': {     // dano em um inimigo (o alvo aplica no proprio jogador)
      if (!c.match) break;
      const to = c.match.players.get(String(m.to));
      const dmg = Math.min(400, Math.max(0, Number(m.dmg) || 0));
      if (!to || to.team === c.team || !dmg) break;
      to.send({ t: 'hit', from: c.id, dmg });
      break;
    }
    case 'dead': {
      if (!c.match) break;
      c.deaths++;
      const k = c.match.players.get(String(m.by));
      if (k && k !== c && k.team !== c.team) k.kills++;
      mbroadcast(c.match, { t: 'feed', victim: c.id, killer: k ? k.id : null, kills: k ? k.kills : 0, vname: c.name, kname: k ? k.name : '' });
      break;
    }
    case 'relay': {   // passos seguintes: reenvia estado (posicao, tiro) para os outros da sala
      const room = c.room;
      if (!room || room.state !== 'playing') break;
      broadcast(room, { t: 'relay', from: c.id, d: m.d }, c.id);
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------ http + upgrade
function serveStatic(url, res) {
  let rel = decodeURIComponent(url === '/' ? '/index.html' : url);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
  return true;
}
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url !== '/health' && url !== '/version' && serveStatic(url, res)) return;
  if (url === '/health' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok ' + VERSION + ' salas=' + rooms.size + ' partidas=' + matches.size);
  } else if (url === '/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: VERSION, rooms: rooms.size }));
  } else { res.writeHead(404); res.end('nao encontrado'); }
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acceptKey(key) + '\r\n\r\n');
  const c = new Client(socket);
  c.send({ t: 'hello', version: VERSION, max: MAX_PLAYERS, matchMax: MATCH_MAX });
});

// limpeza de salas paradas e conexoes mortas
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    for (const p of room.players.values()) if (now - p.lastMsg > 90000) p.socket.destroy();
    if (now - room.touched > ROOM_IDLE_MS && room.players.size === 0) rooms.delete(room.code);
  }
}, 30000).unref();

if (require.main === module) server.listen(PORT, () => console.log('Servidor de salas na porta ' + PORT + ' (' + VERSION + ')'));
module.exports = { server, rooms, matches };
