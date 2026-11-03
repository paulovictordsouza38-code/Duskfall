// Partida online: jogadores remotos (amigo = apelido, inimigo = triangulo vermelho), estado a ~12 Hz, tiros e dano.
import * as THREE from 'three';
import { Actor } from './actors.js';
import { rayVsPlayer } from './logic/combat.js';

export class Online {
  /** @param {object} o { net, scene, makeRig } */
  constructor(o) {
    this.o = o;
    this.remotes = new Map();
    this.root = new THREE.Group();
    this.root.name = 'online';
    o.scene.add(this.root);
    this.active = false;
    this.you = null;
    this.team = null;
    this.sendT = 0;
    this.t = 0;
  }

  begin(info) {
    this.clear();
    this.active = true;
    this.you = info.you;
    this.team = info.team;
    for (const p of info.players) this.add(p);
  }

  add(p) {
    if (p.id === this.you || this.remotes.has(p.id)) return;
    const a = new Actor({ makeRig: this.o.makeRig, shadows: false });
    a.setRole(p.team === this.team ? 'friend' : 'enemy', p.name);
    a.id = p.id; a.team = p.team; a.name = p.name;
    a.tgt = null;
    a.root.visible = false;
    this.root.add(a.root);
    this.remotes.set(p.id, a);
  }

  remove(id) {
    const a = this.remotes.get(id);
    if (!a) return;
    this.root.remove(a.root);
    this.remotes.delete(id);
  }

  clear() {
    for (const id of [...this.remotes.keys()]) this.remove(id);
    this.active = false;
  }

  /** Quantos times diferentes do meu ha na partida. */
  get enemyCount() { let n = 0; for (const a of this.remotes.values()) if (a.team !== this.team) n++; return n; }

  snap(list) {
    for (const s of list) {
      const a = this.remotes.get(s.id);
      if (!a) continue;
      a.tgt = s;
    }
  }

  send(obj) { this.o.net.send(obj); }

  sendState(dt, player, view, weaponId, crouch, alive) {
    this.sendT -= dt;
    if (this.sendT > 0) return;
    this.sendT = 0.083;
    this.send({ t: 'st', x: player.x, y: player.y, z: player.z, yaw: view.yaw, w: weaponId, s: player.speed, cr: crouch, a: alive });
  }

  update(dt) {
    this.t += dt;
    for (const a of this.remotes.values()) {
      const s = a.tgt;
      if (!s) continue;
      const wasAlive = a.alive;
      if (!s.a && a.alive) a.die();
      else if (s.a && !a.alive) a.revive();
      if (wasAlive !== a.alive && a.alive) a.place(s.x, s.y, s.z, s.yaw);
      const k = Math.min(1, 12 * dt);
      let dyaw = s.yaw - a.yaw;
      while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
      while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      if (a.alive) {
        a.place(a.x + (s.x - a.x) * k, a.y + (s.y - a.y) * k, a.z + (s.z - a.z) * k, a.yaw + dyaw * k);
        a.speed = s.s; a.crouch = s.cr || 0;
        a.setWeapon(s.w || null);
        a.root.visible = true;
      }
      a.update(dt, this.t);
    }
  }

  /** Raio do jogador contra inimigos vivos. */
  rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const a of this.remotes.values()) {
      if (!a.alive || a.team === this.team || !a.tgt) continue;
      const h = rayVsPlayer(ox, oy, oz, dx, dy, dz, a.x, a.y, a.z, maxDist, a.crouch || 0);
      if (h && (!best || h.t < best.t)) best = { id: a.id, t: h.t, zone: h.zone, actor: a };
    }
    return best;
  }
}
