// Explosivos: barris inflamaveis, granada de fragmentacao, granada de gel (parede de gelo) e as paredes de gelo.
// Nao decide quem leva dano: avisa `onBlast` (o jogo aplica em jogador, bots e jogadores online).
import * as THREE from 'three';
import { groundHeight, makeBox } from './logic/collision.js';

const FRAG = { radius: 7, max: 150, fuse: 2.4 };
const BARREL = { radius: 6, max: 120, fuse: 1.6, chainRadius: 5, chainFuse: 0.5 };
const ICE = { len: 3.6, thick: 0.8, h: 2.4, hp: 1500, life: 50, maxWalls: 12 };
const GRAV = 14;
const _v = new THREE.Vector3();

export class Explosives {
  /**
   * @param {object} o  { scene, colliders, fx, audio, glowTex, onBlast(b), onIce(col), shake(k) }
   */
  constructor(o) {
    this.o = o;
    this.colliders = o.colliders;
    this.barrels = [];
    this.proj = [];
    this.walls = [];
    this.iceMeshes = [];
    this.root = new THREE.Group();
    this.root.name = 'explosivos';
    o.scene.add(this.root);
    this.fragGeo = new THREE.SphereGeometry(0.07, 12, 8);
    this.fragMat = new THREE.MeshStandardMaterial({ color: 0x3f4a35, roughness: 0.55, metalness: 0.4 });
    this.gelMat = new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x2a79b0, emissiveIntensity: 0.9, roughness: 0.2 });
    this.iceGeoCache = new Map();
    this.iceMat = new THREE.MeshStandardMaterial({ color: 0xc3ecff, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.82, emissive: 0x2a6fa0, emissiveIntensity: 0.25 });
    this.glowMat = new THREE.SpriteMaterial({ map: o.glowTex, color: 0xff3a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  }

  addBarrel(b) {
    b.state = 'idle'; b.t = 0; b.dead = false;
    b.glow = new THREE.Sprite(this.glowMat.clone());
    b.glow.scale.set(0.7, 0.7, 1);
    b.glow.position.set(b.x, b.h + 0.25, b.z);
    b.glow.visible = false;
    this.root.add(b.glow);
    this.barrels.push(b);
  }

  _removeCollider(col) { const i = this.colliders.indexOf(col); if (i >= 0) this.colliders.splice(i, 1); }

  // ---------------------------------------------------------------- barris
  /** Raio contra os barris (cilindros). Retorna { barrel, t } do mais proximo ou null. */
  rayBarrel(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = null;
    for (const b of this.barrels) {
      if (b.dead) continue;
      const ax = ox - b.x, az = oz - b.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-9) continue;
      const bb = ax * dx + az * dz;
      const c = ax * ax + az * az - b.r * b.r;
      const disc = bb * bb - a * c;
      if (disc < 0) continue;
      const t = (-bb - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t > 0 && t < maxDist && y >= 0 && y <= b.h && (!best || t < best.t)) best = { barrel: b, t };
    }
    return best;
  }

  ignite(b, delay = BARREL.fuse) {
    if (b.dead || b.state === 'fuse') return;
    b.state = 'fuse';
    b.t = delay;
    b.glow.visible = true;
  }

  _explodeBarrel(b) {
    b.dead = true;
    b.glow.visible = false;
    b.hide();
    this._removeCollider(b.col);
    this.blast(b.x, 0.5, b.z, { ...BARREL, owner: b.igniter || null, kind: 'barrel' });
  }

  // ---------------------------------------------------------------- explosao
  blast(x, y, z, p) {
    const o = this.o;
    _v.set(x, y, z);
    o.fx.blast(_v, p.radius * 0.8);
    if (o.audio) o.audio.explosion();
    if (o.shake) o.shake(p);
    o.onBlast({ x, y, z, radius: p.radius, max: p.max, owner: p.owner || null, kind: p.kind || 'frag' });
    // reacao em cadeia nos barris proximos
    for (const b of this.barrels) {
      if (b.dead || b.state === 'fuse') continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < (p.chainRadius || p.radius * 0.8)) { b.igniter = p.owner; this.ignite(b, BARREL.chainFuse + d * 0.06); }
    }
    // gelo: explosao racha bastante
    for (const w of this.walls.slice()) {
      const d = Math.hypot(w.cx - x, w.cz - z);
      if (d < p.radius) this.damageWall(w, 300);
    }
  }

  // ---------------------------------------------------------------- granadas
  throwGrenade(kind, origin, dir, owner = null, speed = 15) {
    const m = new THREE.Mesh(this.fragGeo, kind === 'gel' ? this.gelMat : this.fragMat);
    m.position.copy(origin);
    m.scale.setScalar(kind === 'gel' ? 1.25 : 1);
    this.root.add(m);
    const g = {
      kind, mesh: m, owner, pos: m.position, vel: dir.clone().multiplyScalar(speed), age: 0, fuse: FRAG.fuse, landed: 0,
      dirX: dir.x, dirZ: dir.z, done: false,
    };
    g.vel.y += 2.6;
    this.proj.push(g);
    if (this.o.audio) this.o.audio.grenadeThrow();
    return g;
  }

  _stepProjectile(g, dt) {
    g.age += dt;
    g.vel.y -= GRAV * dt;
    const len = g.vel.length() * dt;
    if (len > 1e-5) {
      const dx = g.vel.x * dt / len, dy = g.vel.y * dt / len, dz = g.vel.z * dt / len;
      // colisao com colisores: raio da posicao ate a proxima
      let bestT = Infinity;
      let bestBox = null;
      for (const c of this.colliders) {
        if (c.maxY < g.pos.y - len - 0.2 || c.minY > g.pos.y + len + 0.2) continue;
        const t = rayAABBloose(g.pos.x, g.pos.y, g.pos.z, dx, dy, dz, c);
        if (t < bestT) { bestT = t; bestBox = c; }
      }
      if (bestT <= len + 0.06) {
        const t = Math.max(0, bestT - 0.05);
        g.pos.x += dx * t; g.pos.y += dy * t; g.pos.z += dz * t;
        const n = faceNormal(bestBox, g.pos.x + dx * 0.06, g.pos.y + dy * 0.06, g.pos.z + dz * 0.06);
        const vn = g.vel.x * n[0] + g.vel.y * n[1] + g.vel.z * n[2];
        if (vn < 0) { g.vel.x -= 1.45 * vn * n[0]; g.vel.y -= 1.45 * vn * n[1]; g.vel.z -= 1.45 * vn * n[2]; g.vel.multiplyScalar(0.75); }
        g.landed += 1;
      } else {
        g.pos.x += g.vel.x * dt; g.pos.y += g.vel.y * dt; g.pos.z += g.vel.z * dt;
      }
    }
    const gy = groundHeight(g.pos.x, g.pos.z, g.pos.y + 0.4, this.colliders);
    if (g.pos.y < gy + 0.08) {
      g.pos.y = gy + 0.08;
      if (g.vel.y < 0) { g.vel.y *= -0.32; g.vel.x *= 0.72; g.vel.z *= 0.72; }
      g.landed += 1;
      g.gy = gy;
    }
  }

  // ---------------------------------------------------------------- gelo
  _makeIce(g) {
    const alongZ = Math.abs(g.dirX) > Math.abs(g.dirZ);                 // lancou em X -> parede comprida em Z
    const w = alongZ ? ICE.thick : ICE.len;
    const d = alongZ ? ICE.len : ICE.thick;
    const gy = groundHeight(g.pos.x, g.pos.z, g.pos.y + 0.5, this.colliders);
    const col = makeBox(g.pos.x - w / 2, g.pos.z - d / 2, g.pos.x + w / 2, g.pos.z + d / 2, gy, gy + ICE.h);
    this.colliders.push(col);
    const key = w.toFixed(2) + d.toFixed(2);
    let geo = this.iceGeoCache.get(key);
    if (!geo) { geo = new THREE.BoxGeometry(w, ICE.h, d); this.iceGeoCache.set(key, geo); }
    const mesh = new THREE.Mesh(geo, this.iceMat.clone());
    mesh.position.set(g.pos.x, gy + ICE.h / 2, g.pos.z);
    this.root.add(mesh);
    const wall = { mesh, col, hp: ICE.hp, life: ICE.life, cx: g.pos.x, cz: g.pos.z, y0: gy, melt: 0, owner: g.owner };
    mesh.userData.ice = wall;
    col.iceWall = wall;
    this.walls.push(wall);
    this.iceMeshes.push(mesh);
    if (this.walls.length > ICE.maxWalls) this._removeWall(this.walls[0]);
    if (this.o.onIce) this.o.onIce(col);                                 // empurra quem estiver dentro (nunca prende ninguem)
    if (this.o.audio) this.o.audio.ice();
    return wall;
  }

  /** Gelo instantaneo (sem granada voando): a parede ja nasce pronta e solida neste mesmo instante. */
  placeIce(x, z, dirX, dirZ, owner = null) {
    const gy = groundHeight(x, z, 0.8, this.colliders);
    return this._makeIce({ pos: { x, y: gy, z }, dirX, dirZ, owner });
  }

  damageWall(w, dmg) {
    if (w.melt > 0) return;
    w.hp -= dmg;
    w.mesh.material.opacity = 0.35 + 0.47 * Math.max(0, w.hp / ICE.hp);
    if (w.hp <= 0) this._startMelt(w);
  }

  _startMelt(w) {
    if (w.melt > 0) return;
    w.melt = 0.01;
    this._removeCollider(w.col);                                          // some o colisor na hora: ninguem fica preso
  }

  _removeWall(w) {
    this._removeCollider(w.col);
    this.root.remove(w.mesh);
    w.mesh.material.dispose();
    const i = this.walls.indexOf(w); if (i >= 0) this.walls.splice(i, 1);
    const j = this.iceMeshes.indexOf(w.mesh); if (j >= 0) this.iceMeshes.splice(j, 1);
  }

  // ---------------------------------------------------------------- quadro
  update(dt) {
    for (const b of this.barrels) {
      if (b.dead || b.state !== 'fuse') continue;
      b.t -= dt;
      b.glow.material.opacity = 0.5 + 0.5 * Math.abs(Math.sin(b.t * 14));
      if (b.t <= 0) this._explodeBarrel(b);
    }
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const g = this.proj[i];
      this._stepProjectile(g, dt);
      let end = false;
      if (g.kind === 'frag') {
        if (g.age >= g.fuse) { this.blast(g.pos.x, g.pos.y + 0.2, g.pos.z, { ...FRAG, owner: g.owner, kind: 'frag' }); end = true; }
      } else if (g.landed > 0 && g.age > 0.08) {
        g.landed += 1;
        if (g.landed > 2) { this._makeIce(g); end = true; }
        if (g.age > 2.5) { this._makeIce(g); end = true; }
      } else if (g.age > 2.5) { this._makeIce(g); end = true; }
      if (end) { this.root.remove(g.mesh); this.proj.splice(i, 1); }
    }
    for (const w of this.walls.slice()) {
      if (w.melt > 0) {
        w.melt += dt;
        const k = Math.min(1, w.melt / 0.8);
        w.mesh.scale.y = Math.max(0.02, 1 - k);
        w.mesh.position.y = w.y0 + (ICE.h * (1 - k)) / 2;
        w.mesh.material.opacity = 0.8 * (1 - k);
        if (k >= 1) this._removeWall(w);
      } else {
        w.life -= dt;
        if (w.life <= 0) this._startMelt(w);
      }
    }
  }

  /** Volta tudo ao inicio da partida. */
  reset() {
    for (const g of this.proj) this.root.remove(g.mesh);
    this.proj.length = 0;
    for (const w of this.walls.slice()) this._removeWall(w);
    for (const b of this.barrels) {
      if (b.dead && b.show) { b.show(); this.colliders.push(b.col); }
      b.dead = false; b.state = 'idle'; b.glow.visible = false;
    }
  }
}

// raio contra caixa (colisor), tolerante: usa os limites y do colisor
function rayAABBloose(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const axes = [[ox, dx, b.minX, b.maxX], [oy, dy, b.minY, b.maxY], [oz, dz, b.minZ, b.maxZ]];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

function faceNormal(b, x, y, z) {
  if (b.circle) { const dx = x - b.x, dz = z - b.z, l = Math.hypot(dx, dz) || 1; return [dx / l, 0, dz / l]; }
  const d = [Math.abs(x - b.minX), Math.abs(x - b.maxX), Math.abs(y - b.minY), Math.abs(y - b.maxY), Math.abs(z - b.minZ), Math.abs(z - b.maxZ)];
  let k = 0;
  for (let i = 1; i < 6; i++) if (d[i] < d[k]) k = i;
  return [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][k];
}

export const EXPLOSIVE_STATS = { FRAG, BARREL, ICE };
