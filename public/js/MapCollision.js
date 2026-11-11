// DUSKFALL ISLAND - colisao do mapa. PURO (sem Three.js).
// CAMADA DE COMPATIBILIDADE: os objetos viram colisores no MESMO formato do jogo atual (makeBox/makeCircle de
// logic/collision.js), entao resolveMovement/rayShot existentes funcionam sem mudanca. O terreno entra por cima:
// altura do chao = maior entre o terreno e o topo dos colisores pisaveis.
// Colisores de um setor nascem do PropPlacer (deterministico), nao da malha: existem mesmo antes do desenho aparecer.
import { makeBox, makeCircle, resolveMovement, groundHeight as boxGround, rayShot as boxRayShot } from './logic/collision.js';
import { placeProps, BUILDING_CLASSES, FLOOR_H } from './PropPlacer.js';

export const WATER_LIMIT = -1.3;      // ate a altura do peito dentro d'agua
export const MAX_SLOPE = 1.28;        // ~52 graus: mais ingreme que isso nao se sobe

export class MapCollision {
  constructor(sampler, cfg, cacheLimit = 80) {
    this.s = sampler; this.cfg = cfg; this.grid = cfg.grid; this.sector = cfg.size / cfg.grid; this.half = cfg.size / 2;
    this.cacheLimit = cacheLimit;
    this._props = new Map(); this._cols = new Map();
    this._nearKey = -1; this._near = [];
  }

  sectorOf(x, z) {
    return {
      ix: Math.max(0, Math.min(this.grid - 1, Math.floor((x + this.half) / this.sector))),
      iz: Math.max(0, Math.min(this.grid - 1, Math.floor((z + this.half) / this.sector))),
    };
  }

  /** Objetos do setor (compartilhado com o desenho: so calcula uma vez). */
  propsFor(ix, iz) {
    const k = iz * this.grid + ix;
    let p = this._props.get(k);
    if (!p) {
      p = placeProps(this.s, this.cfg, ix, iz); this._props.set(k, p);
      if (this._props.size > this.cacheLimit) { const old = this._props.keys().next().value; this._props.delete(old); this._cols.delete(old); }
    }
    return p;
  }

  /** Colisores do setor, no formato do jogo atual. */
  collidersFor(ix, iz) {
    const k = iz * this.grid + ix;
    let c = this._cols.get(k);
    if (c) return c;
    const p = this.propsFor(ix, iz); c = [];
    for (const t of p.trees) c.push(makeCircle(t.x, t.z, 0.4 * t.s, t.y - 0.5, t.y + 9 * t.s));
    for (const r of p.rocks) c.push(makeCircle(r.x, r.z, Math.max(r.sx, r.sz) * 0.8, r.y, r.y + r.sy * 1.3));
    for (const b of p.buildings) {
      const cl = BUILDING_CLASSES[b.cls]; const hw = (b.r ? cl.d : cl.w) / 2; const hd = (b.r ? cl.w : cl.d) / 2;
      c.push(makeBox(b.x - hw, b.z - hd, b.x + hw, b.z + hd, b.y - FLOOR_H, b.y + cl.floors * FLOOR_H));
    }
    this._cols.set(k, c);
    return c;
  }

  /** Colisores do setor do ponto + os 8 vizinhos (lista reaproveitada enquanto o setor nao muda). */
  near(x, z) {
    const s = this.sectorOf(x, z); const key = s.iz * this.grid + s.ix;
    if (key === this._nearKey) return this._near;
    const out = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const ix = s.ix + dx; const iz = s.iz + dz;
      if (ix < 0 || iz < 0 || ix >= this.grid || iz >= this.grid) continue;
      for (const c of this.collidersFor(ix, iz)) out.push(c);
    }
    this._nearKey = key; this._near = out;
    return out;
  }

  /** Pode pisar aqui? (dentro do mapa, fora d'agua funda, sem encosta impossivel). */
  walkable(x, z) { return this.s.inBounds(x, z) && this.s.height(x, z) - this.s.sea > WATER_LIMIT && this.s.slope(x, z) < MAX_SLOPE; }

  /** Altura do chao sob (x,z) para quem esta na altura y: terreno ou topo de objeto pisavel. */
  groundHeight(x, z, y = -Infinity) {      // sem y: so o terreno
    const t = this.s.height(x, z);
    const g = boxGround(x, z, y, this.near(x, z));
    return g > 0 && g > t ? g : t;           // boxGround devolve 0 quando nao ha colisor pisavel
  }

  /** Empurra pos ({x,z}) para fora de arvores, rochas e predios. Mesma assinatura do jogo atual. */
  resolve(pos, radius, y) { return resolveMovement(pos, radius, this.near(pos.x, pos.z), 4, y); }

  /** Distancia ate o terreno ao longo do raio (direcao normalizada), ou Infinity. */
  rayTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
    const s = this.s;
    if (oy < s.height(ox, oz)) return 0;
    let tPrev = 0; let t = 0;
    while (t < maxDist) {
      t = Math.min(maxDist, t + Math.max(1, Math.min(4, 1 + t * 0.02)));
      if (oy + dy * t < s.height(ox + dx * t, oz + dz * t)) {
        let lo = tPrev; let hi = t;
        for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (oy + dy * m < s.height(ox + dx * m, oz + dz * m)) hi = m; else lo = m; }
        return hi;
      }
      tPrev = t;
      if (t >= maxDist) break;
    }
    return Infinity;
  }

  /** Colisores dos setores que o raio atravessa. */
  collidersAlong(ox, oz, dx, dz, maxDist) {
    const seen = new Set(); const out = [];
    const step = this.sector / 2;
    for (let t = 0; t <= maxDist + step; t += step) {
      const s = this.sectorOf(ox + dx * Math.min(t, maxDist), oz + dz * Math.min(t, maxDist));
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ix = s.ix + a; const iz = s.iz + b; if (ix < 0 || iz < 0 || ix >= this.grid || iz >= this.grid) continue;
        const k = iz * this.grid + ix; if (seen.has(k)) continue; seen.add(k);
        for (const c of this.collidersFor(ix, iz)) out.push(c);
      }
    }
    return out;
  }

  /** Raio de tiro/camera contra terreno + objetos. Retorna { t, kind: 'terreno'|'objeto', box } ou null. */
  rayShot(ox, oy, oz, dx, dy, dz, maxDist) {
    const obj = boxRayShot(ox, oy, oz, dx, dy, dz, maxDist, this.collidersAlong(ox, oz, dx, dz, maxDist));
    const tt = this.rayTerrain(ox, oy, oz, dx, dy, dz, maxDist);
    if (obj && obj.t <= tt) return { t: obj.t, kind: 'objeto', box: obj.box };
    if (tt <= maxDist) return { t: tt, kind: 'terreno', box: null };
    return null;
  }

  dispose() { this._props.clear(); this._cols.clear(); this._near = []; this._nearKey = -1; }
}
