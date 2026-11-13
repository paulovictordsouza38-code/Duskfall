// Bots: usam o mesmo operador do jogo e andam pelo mapa atras do jogador enquanto a partida e so contra o computador.
import * as THREE from 'three';
import { Actor } from './actors.js';
import { WEAPONS } from './logic/weapons.js';
import { rayVsPlayer, shotDamage, HP_MAX } from './logic/combat.js';
import { resolveMovement, rayBoxes, rayShot, groundHeight } from './logic/collision.js';

const BOT_WEAPONS = ['mp5', 'xm8', 'famas', 'scar', 'mp40', 'g18', 'usp', 'mp5', 'xm8', 'awm'];
const _m = new THREE.Vector3();
const _e = new THREE.Vector3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

const BOT_NAMES = ['Rocha', 'Fantasma', 'Lobo', 'Corvo', 'Sombra', 'Falcão', 'Trovão', 'Víbora', 'Ghost', 'Alpha', 'Bravo', 'Delta'];

export class BotManager {
  /** @param {object} o { scene, colliders, makeRig, waypoints:[{x,z}], rand, count } */
  constructor(o) {
    this.o = o;
    this.bots = [];
    this.root = new THREE.Group();
    this.root.name = 'bots';
    o.scene.add(this.root);
    this.enabled = false;
    this.rand = o.rand || Math.random;
    this.t = 0;
    this._built = false;
  }

  _build() {
    if (this._built) return;
    this._built = true;
    for (let i = 0; i < this.o.count; i++) {
      const a = new Actor({ makeRig: this.o.makeRig, shadows: false });
      a.setRole('enemy', BOT_NAMES[i % BOT_NAMES.length]);
      a.id = 'bot' + i;
      this.root.add(a.root);
      a.ai = { goal: null, cool: 0, burst: 0, rest: 0, seenT: -9, strafe: 1, strafeT: 0, stuckT: 0, lx: 0, lz: 0, check: i * 0.07, respawn: 0, speed: 0 };
      this.bots.push(a);
    }
  }

  _spawnPoint(avoid) {
    const wps = this.o.waypoints;
    for (let k = 0; k < 30; k++) {
      const w = wps[Math.floor(this.rand() * wps.length)];
      if (!avoid || Math.hypot(w.x - avoid.x, w.z - avoid.z) > 28) return w;
    }
    return wps[0];
  }

  _respawn(b, avoid) {
    const w = this._spawnPoint(avoid);
    b.revive();
    b.hp = Math.round(HP_MAX * 0.6);   // bots mais frageis
    { const sx = w.x + (this.rand() - 0.5) * 2, sz = w.z + (this.rand() - 0.5) * 2; b.place(sx, groundHeight(sx, sz, 0, this.o.colliders), sz, this.rand() * Math.PI * 2); }
    b.setWeapon(BOT_WEAPONS[Math.floor(this.rand() * BOT_WEAPONS.length)]);
    b.ai.goal = null; b.ai.cool = 1.2; b.ai.seenT = -9;
    b.root.visible = true;
  }

  start(avoid) {
    this._build();
    this.enabled = true;
    for (const b of this.bots) { this._respawn(b, avoid); b.root.visible = true; }
  }

  stop() {
    this.enabled = false;
    for (const b of this.bots) b.root.visible = false;
  }

  /** Raio do jogador contra os bots vivos. Retorna { bot, t, zone } do mais proximo ou null. */
  rayHit(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!this.enabled) return null;
    let best = null;
    for (const b of this.bots) {
      if (!b.alive) continue;
      const h = rayVsPlayer(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z, maxDist, 0);
      if (h && (!best || h.t < best.t)) best = { bot: b, t: h.t, zone: h.zone };
    }
    return best;
  }

  /** Aplica dano a um bot. Retorna true se morreu. */
  damage(b, dmg, zone) {
    if (!b.alive) return false;
    b.hp -= shotDamage(dmg, zone);
    b.ai.seenT = this.t;                                           // quem leva tiro acha o jogador
    if (b.hp <= 0) { b.die(); b.ai.respawn = 7; if (this.onDeath) this.onDeath(b); return true; }
    return false;
  }

  /** Dano de explosao em todos os bots no raio. Retorna quantos morreram. */
  blast(x, y, z, radius, dmgFn) {
    let kills = 0;
    for (const b of this.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - x, b.y + 0.9 - y, b.z - z);
      if (d < radius) { const dm = dmgFn(d); b.hp -= dm; if (b.hp <= 0) { b.die(); b.ai.respawn = 7; kills++; if (this.onDeath) this.onDeath(b); } }
    }
    return kills;
  }

  /**
   * ctx: { player:{x,y,z,alive,speed}, time, hitPlayer(dmg, bot, zone), tracer(a,b), sound(id, dist) }
   */
  update(dt, ctx) {
    if (!this.enabled) return;
    this.t += dt;
    const P = ctx.player;
    for (const b of this.bots) {
      const ai = b.ai;
      if (!b.alive) {
        b.update(dt, this.t);
        ai.respawn -= dt;
        if (ai.respawn <= 0) this._respawn(b, P);
        continue;
      }
      const dxp = P.x - b.x, dzp = P.z - b.z;
      const dist = Math.hypot(dxp, dzp);
      const far = dist > 95;
      b.root.visible = !far;
      // percepcao (a cada 0.25 s)
      ai.check -= dt;
      if (ai.check <= 0) {
        ai.check = 0.25;
        if (P.alive && dist < 70) {
          const ey = 1.55;
          _m.set(b.x, b.y + ey, b.z);
          _e.set(P.x, P.y + 1.4, P.z);
          const dir = _e.clone().sub(_m);
          const L = dir.length();
          dir.multiplyScalar(1 / L);
          if (rayBoxes(_m.x, _m.y, _m.z, dir.x, dir.y, dir.z, L, this.o.colliders) === Infinity) ai.seenT = this.t;
        }
      }
      const engaged = P.alive && this.t - ai.seenT < 1.2;
      let moveX = 0, moveZ = 0, spd = 0;
      let targetYaw = b.yaw;
      if (engaged) {
        const wantYaw = Math.atan2(-dxp, -dzp);                      // frente do ator = -Z
        targetYaw = wantYaw;
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) { ai.strafeT = 1 + this.rand() * 1.6; ai.strafe = this.rand() < 0.5 ? -1 : 1; }
        const fwd = dist > 24 ? 1 : dist < 9 ? -0.8 : 0.1;
        const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
        const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
        moveX = fx * fwd + rx * ai.strafe * 0.7;
        moveZ = fz * fwd + rz * ai.strafe * 0.7;
        spd = 2.6;
        // tiro
        ai.cool -= dt;
        const err = Math.abs(wrap(wantYaw - b.yaw));
        if (ai.rest > 0) ai.rest -= dt;
        else if (ai.cool <= 0 && err < 0.2 && dist < 80) {
          const cfg = WEAPONS[b.weaponId];
          ai.cool = cfg.interval * (cfg.auto ? 3.0 : 1.7) * (1 + this.rand() * 0.8) + (cfg.kind === 'sniper' ? 1.2 : 0);
          ai.burst++;
          b.lastShot = ctx.time;          // o radar so mostra o bot quando ele atira
          if (ai.burst >= (cfg.auto ? 3 + Math.floor(this.rand() * 4) : 2)) { ai.burst = 0; ai.rest = 0.5 + this.rand() * 1.1; }
          const move = P.speed > 2 ? 0.75 : 1;
          const hitP = clamp((0.5 - dist * 0.0085) * move * 0.55, 0.03, 0.26);
          b.muzzleWorld(_m);
          _e.set(P.x, P.y + 1.3, P.z);
          let hit = this.rand() < hitP;
          // a bala do bot tambem nao atravessa paredes, ferro ou gelo
          { const dx = P.x - _m.x, dy = P.y + 1.3 - _m.y, dz = P.z - _m.z, L = Math.hypot(dx, dy, dz) || 1;
            const w = rayShot(_m.x, _m.y, _m.z, dx / L, dy / L, dz / L, L, this.o.colliders);
            if (w && w.t < L - 0.3) { hit = false; _e.set(_m.x + (dx / L) * w.t, _m.y + (dy / L) * w.t, _m.z + (dz / L) * w.t); ai.wall = true; } else ai.wall = false; }
          if (!hit && !ai.wall) { _e.x += (this.rand() - 0.5) * 2.4; _e.y += (this.rand() - 0.5) * 1.6; _e.z += (this.rand() - 0.5) * 2.4; }
          if (ctx.tracer) ctx.tracer(_m, _e);
          if (ctx.sound) ctx.sound(b.weaponId, dist);
          if (hit) ctx.hitPlayer(Math.round(cfg.dmg * 0.55), b, this.rand() < 0.06 ? 'cabeca' : 'peito');
        }
      } else {
        // passeia entre pontos do mapa
        if (!ai.goal || Math.hypot(ai.goal.x - b.x, ai.goal.z - b.z) < 1.6) ai.goal = this.o.waypoints[Math.floor(this.rand() * this.o.waypoints.length)];
        const gx = ai.goal.x - b.x, gz = ai.goal.z - b.z, gl = Math.hypot(gx, gz) || 1;
        moveX = gx / gl; moveZ = gz / gl;
        targetYaw = Math.atan2(-moveX, -moveZ);
        spd = 3.0;
      }
      // gira
      b.yaw = wrap(b.yaw + clamp(wrap(targetYaw - b.yaw), -6 * dt, 6 * dt));
      // anda
      const ml = Math.hypot(moveX, moveZ);
      let moved = 0;
      if (ml > 0.01 && !far || (far && ml > 0.01)) {
        const step = (spd * dt) / ml;
        const p = { x: b.x + moveX * step, z: b.z + moveZ * step };
        resolveMovement(p, 0.34, this.o.colliders, 2, b.y);
        moved = Math.hypot(p.x - b.x, p.z - b.z);
        b.x = p.x; b.z = p.z;
      }
      b.speed += ((moved / dt) - b.speed) * Math.min(1, 8 * dt);
      b.place(b.x, groundHeight(b.x, b.z, b.y || 0, this.o.colliders), b.z, b.yaw);   // acompanha morros, ravina e degraus
      // preso: troca de destino
      ai.stuckT += dt;
      if (ai.stuckT > 1.5) {
        if (Math.hypot(b.x - ai.lx, b.z - ai.lz) < 0.5) ai.goal = null;
        ai.lx = b.x; ai.lz = b.z; ai.stuckT = 0;
      }
      ai.acc = (ai.acc || 0) + dt; ai.fr = (ai.fr || 0) + 1;
      const every = dist > 50 ? 4 : 2;               // longe: anima menos vezes (mais fps)
      if (b.rig) b.rig.group.visible = dist < 42 && b.alive;           // arma some de longe (menos desenho)
      if (!far && ai.fr % every === 0) { b.update(ai.acc, this.t); ai.acc = 0; }
    }
  }
}
