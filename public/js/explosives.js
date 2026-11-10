// Explosivos: barris inflamaveis, granada de fragmentacao, granada de gel (parede de gelo) e as paredes de gelo.
// Nao decide quem leva dano: avisa `onBlast` (o jogo aplica em jogador, bots e jogadores online).
import * as THREE from 'three';
import { groundHeight, makeBox } from './logic/collision.js';

const FRAG = { radius: 7, max: 150, fuse: 2.4 };
const BARREL = { radius: 6, max: 120, fuse: 3.2, chainRadius: 5, chainFuse: 1.0 };
const BARREL_HP = 300;      // vida do barril: balas tiram a barra; ao zerar ele explode (tiros: pistola ~10, fuzil ~12, AWM 2)
const TOXIC = { fuse: 3.2, radius: 15, life: 15 };      // barril de fumaca: nuvem de 15 m de raio (~20 passos) por 15 s
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
    this.smokeCount = 24;
    this.clouds = [];
    this.smokeTex = makeSmokeTex();
    this.glowMat = new THREE.SpriteMaterial({ map: o.glowTex, color: 0xff3a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  }

  addBarrel(b) {
    b.state = 'idle'; b.t = 0; b.dead = false; b.hp = b.maxHp = BARREL_HP;
    b.glow = new THREE.Sprite(this.glowMat.clone());
    b.glow.scale.set(0.7, 0.7, 1);
    b.glow.position.set(b.x, b.h + 0.25, b.z);
    b.glow.visible = false;
    this.root.add(b.glow);
    // barra do tempo ate explodir (aparece quando o barril e atingido)
    const W = 1.0, H = 0.11;
    b.barW = W;
    b.barBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x101214, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    b.barBg.scale.set(W + 0.07, H + 0.07, 1);
    b.barFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: b.toxic ? 0x39d0ff : 0xff9a2a, transparent: true, depthWrite: false, toneMapped: false }));
    b.barFill.scale.set(W, H, 1);
    b.barBg.renderOrder = 20; b.barFill.renderOrder = 21;
    b.barBg.position.set(b.x, b.h + 0.6, b.z); b.barFill.position.copy(b.barBg.position);
    b.barBg.visible = b.barFill.visible = false;
    this.root.add(b.barBg, b.barFill);
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

  ignite(b, delay = BARREL.fuse, sound = true) {
    if (b.dead || b.state === 'fuse') return;
    b.state = 'fuse';
    b.t = delay; b.fuseT = delay;
    b.glow.visible = true;
    b.barBg.visible = b.barFill.visible = true;
    this._bar(b, 1);
    if (sound && this.o.audio && this.o.audio.barrelHit) this.o.audio.barrelHit();   // ricochete da bala no barril
  }

  /** Bala acertou o barril: tira vida (barra). Explode so quando a vida zera. */
  damageBarrel(b, dmg, owner) {
    if (b.dead || b.state === 'fuse') return;
    if (owner) b.igniter = owner;
    b.hp = Math.max(0, b.hp - dmg);
    b.barBg.visible = b.barFill.visible = true;
    this._bar(b, b.hp / b.maxHp);
    if (this.o.audio && this.o.audio.barrelHit) this.o.audio.barrelHit();     // ricochete
    if (b.hp <= 0) this._explodeBarrel(b);
  }

  // barra: preenche da esquerda e encolhe conforme o tempo acaba (sprite ancorado a esquerda)
  _bar(b, k) {
    k = Math.max(0.001, Math.min(1, k));
    b.barFill.scale.x = b.barW * k;
    b.barFill.center.set(0.5 / k, 0.5);
  }

  _explodeBarrel(b) {
    b.dead = true;
    b.glow.visible = false;
    b.barBg.visible = b.barFill.visible = false;
    b.hide();
    this._removeCollider(b.col);
    if (b.toxic) { this._smoke(b.x, b.z); return; }
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
      if (d < (p.chainRadius || p.radius * 0.8)) { b.igniter = p.owner; this.ignite(b, BARREL.chainFuse + d * 0.1, false); }
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


  // ---------------------------------------------------------------- fumaca toxica
  _smoke(x, z) {
    const o = this.o;
    if (o.audio && o.audio.toxicBlast) o.audio.toxicBlast();
    if (o.shake) o.shake({ radius: 6 });
    const mat = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x86b8ee, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
    const n = this.smokeCount, sprites = [];
    for (let i = 0; i < n; i++) {
      const ang = (i * 2.399963) + Math.random() * 0.5;            // espalha em espiral (cobre o raio todo)
      const rr = Math.sqrt((i + 0.5) / n) * TOXIC.radius * (0.7 + Math.random() * 0.3);
      const size = 6 + Math.random() * 4;
      const sp = new THREE.Sprite(mat);
      sp.scale.set(size, size, 1);
      sp.userData = { ox: Math.cos(ang) * rr, oz: Math.sin(ang) * rr, y: 1.0 + Math.random() * 2.4, size, vy: 0.03 + Math.random() * 0.05 };
      sp.position.set(x, sp.userData.y, z);
      this.root.add(sp);
      sprites.push(sp);
    }
    this.clouds.push({ x, z, mat, sprites, t: 0 });
  }
  _updateClouds(dt) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t += dt;
      const t = c.t, L = TOXIC.life;
      const grow = Math.min(1, t / 2.2), e = 1 - (1 - grow) * (1 - grow);       // expande rapido e desacelera
      const fadeIn = Math.min(1, t / 0.8), fadeOut = Math.min(1, Math.max(0, (L - t) / 3.5));
      c.mat.opacity = 0.62 * fadeIn * fadeOut;
      for (const sp of c.sprites) {
        const u = sp.userData;
        sp.position.set(c.x + u.ox * e, u.y + u.vy * t, c.z + u.oz * e);
        const sc = u.size * (0.55 + 0.45 * e);
        sp.scale.set(sc, sc, 1);
      }
      if (t >= L) { this._freeCloud(c); this.clouds.splice(i, 1); }
    }
  }
  _freeCloud(c) {
    for (const sp of c.sprites) this.root.remove(sp);
    c.mat.dispose();
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
      this._bar(b, b.t / (b.fuseT || BARREL.fuse));
      if (b.t <= 0) this._explodeBarrel(b);
    }
    this._updateClouds(dt);
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
      b.dead = false; b.state = 'idle'; b.hp = b.maxHp; b.glow.visible = false; b.barBg.visible = b.barFill.visible = false;
    }
    for (const c of this.clouds) this._freeCloud(c);
    this.clouds.length = 0;
  }
}

function makeSmokeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) {                       // varias manchas macias = nuvem com cara de fumaca
    const x = 64 + (Math.sin(i * 2.1) * 26), y = 64 + (Math.cos(i * 3.3) * 26), r = 34 + (i % 3) * 8;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
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
