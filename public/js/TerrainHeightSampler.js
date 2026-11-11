// DUSKFALL ISLAND - altura do terreno. Modulo PURO (sem Three.js): roda no Node e e deterministico
// (mesma semente = mesma ilha em todos os clientes). Tudo em metros; nivel do mar = cfg.seaLevel.

function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function vnoise(x, z, seed) {
  const ix = Math.floor(x); const iz = Math.floor(z);
  const fx = fade(x - ix); const fz = fade(z - iz);
  const a = hash2(ix, iz, seed); const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed); const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;     // 0..1
}
function fbm(x, z, seed, oct) {
  let s = 0; let amp = 0.5; let f = 1; let norm = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f, seed + i * 31) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm;                                                         // 0..1
}
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export class TerrainHeightSampler {
  constructor(cfg) {
    this.cfg = cfg;
    this.seed = cfg.seed | 0;
    this.half = cfg.size / 2;
    this.sea = cfg.seaLevel || 0;
    this.regions = cfg.regions || [];
  }

  /** 0 = oceano aberto, 1 = interior da ilha (borda irregular por ruido). */
  _mask(x, z) {
    const warp = (fbm(x * 0.004 + 11, z * 0.004 - 7, this.seed, 3) - 0.5) * 0.36;
    const d = Math.hypot(x, z) / (this.half * 0.92) * (1 + warp);
    return 1 - smooth(0.55, 1.0, d);
  }

  _regionWeight(r, x, z) {
    const d = Math.hypot(x - r.x, z - r.z);
    return 1 - smooth(r.r * 0.5, r.r, d);
  }

  height(x, z) {
    const m = this._mask(x, z);
    const land = smooth(0, 0.8, m);                                  // 0 no mar, 1 no interior
    let h = -10 + 14 * land;                                        // perfil de praia: sobe do fundo ate +4 m
    h += (fbm(x * 0.012, z * 0.012, this.seed + 5, 4) - 0.5) * 3 * land;   // ondulacao suave da planicie
    const inland = smooth(0.62, 1.0, m);                              // regioes so crescem depois da praia
    for (const r of this.regions) {
      const w = this._regionWeight(r, x, z) * inland;
      if (w <= 0) continue;
      if (r.type === 'plateau') {
        const target = r.h + (fbm(x * 0.03, z * 0.03, this.seed + 9, 2) - 0.5) * 0.3;
        h += (target - h) * w;                                      // aplaina para a cidade
      } else if (r.type === 'hills') {
        h += r.amp * fbm(x * 0.018, z * 0.018, this.seed + 13, 4) * w;
      }
    }
    return h + this.sea;
  }

  /** Normal (unitaria) por diferencas centrais. */
  normal(x, z, out = { x: 0, y: 1, z: 0 }, e = 0.8) {
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    out.x = -dx / l; out.y = 2 * e / l; out.z = -dz / l;
    return out;
  }

  /** Inclinacao = tan do angulo (1 = 45 graus). */
  slope(x, z) {
    const e = 1;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  /** Regiao dominante no ponto: id da regiao, 'praia', 'planicie' ou 'oceano'. */
  regionAt(x, z) {
    const h = this.height(x, z) - this.sea;
    if (h < -0.3) return 'oceano';
    let best = null; let bw = 0.18;
    for (const r of this.regions) { const w = this._regionWeight(r, x, z); if (w > bw) { bw = w; best = r.id; } }
    if (best) return best;
    return h < 2.5 ? 'praia' : 'planicie';
  }

  regionName(id) {
    const r = this.regions.find((q) => q.id === id);
    return r ? r.name : ({ oceano: 'Oceano', praia: 'Praia', planicie: 'Planicie' }[id] || id);
  }

  /** Dentro dos limites fisicos do mapa (quadrado do mundo). */
  inBounds(x, z) { return Math.abs(x) <= this.half && Math.abs(z) <= this.half; }
}
