// DUSKFALL ISLAND - onde ficam arvores, rochas e predios. PURO (sem Three.js) e DETERMINISTICO: todos os clientes
// calculam as mesmas posicoes a partir da semente, entao nada disso precisa ser enviado pelo servidor.
// Cada objeto pertence a UM setor (o do seu centro); um setor so gera o que e seu.

export const CITY_PITCH = 36;     // quarteirao 28 m + rua 8 m
export const CITY_STREET = 8;
export const BUILDING_CLASSES = [
  { w: 12, d: 12, floors: 2 },
  { w: 16, d: 13, floors: 3 },
  { w: 18, d: 14, floors: 4 },
  { w: 22, d: 16, floors: 5 },
];
export const FLOOR_H = 3.3;

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Rua da cidade neste ponto? (grade alinhada aos eixos a partir do centro da regiao). */
export function cityRoad(region, x, z) {
  const u = (((x - region.x) % CITY_PITCH) + CITY_PITCH) % CITY_PITCH;
  const v = (((z - region.z) % CITY_PITCH) + CITY_PITCH) % CITY_PITCH;
  return u < CITY_STREET || v < CITY_STREET;
}

export function cityRegion(cfg) { return (cfg.regions || []).find((r) => r.type === 'plateau') || null; }

/**
 * Props do setor (ix,iz). Retorna { trees, rocks, buildings }; cada item tem x, y (altura do chao), z.
 * trees: { s (escala), r (rotacao) }  rocks: { sx, sy, sz, r }  buildings: { cls, r (0 ou pi/2), tint }
 */
export function placeProps(sampler, cfg, ix, iz) {
  const sector = cfg.size / cfg.grid; const x0 = -cfg.size / 2 + ix * sector; const z0 = -cfg.size / 2 + iz * sector;
  const seed = cfg.seed | 0; const out = { trees: [], rocks: [], buildings: [] };
  const city = cityRegion(cfg);
  const forest = (cfg.regions || []).find((r) => r.type === 'hills');

  // ---- arvores: grade com jitter de 6 m
  const cell = 6; const R = rng(hash(ix, iz, seed + 101) * 4294967295);
  for (let cz = 0; cz < sector / cell; cz++) {
    for (let cx = 0; cx < sector / cell; cx++) {
      const x = x0 + (cx + 0.15 + R() * 0.7) * cell; const z = z0 + (cz + 0.15 + R() * 0.7) * cell;
      const roll = R(); const s = 0.8 + R() * 0.7; const rot = R() * 6.283;
      const h = sampler.height(x, z) - sampler.sea;
      if (h < 3.2) continue;                                   // nada na praia/agua
      if (sampler.slope(x, z) > 0.62) continue;                // nem em encosta forte
      let p = 0.02;                                            // planicie: arvore solta
      if (forest) p = Math.max(p, 0.78 * Math.pow(sampler._regionWeight(forest, x, z), 0.7));
      if (city) {
        const wc = sampler._regionWeight(city, x, z);
        if (wc > 0.12 || cityRoad(city, x, z) && wc > 0.05) p = 0;
      }
      if (roll < p) out.trees.push({ x, y: sampler.height(x, z), z, s, r: rot });
    }
  }

  // ---- rochas: na floresta e algumas na praia
  const R2 = rng(hash(ix, iz, seed + 202) * 4294967295); const rc = 10;
  for (let cz = 0; cz < sector / rc; cz++) {
    for (let cx = 0; cx < sector / rc; cx++) {
      const x = x0 + (cx + 0.1 + R2() * 0.8) * rc; const z = z0 + (cz + 0.1 + R2() * 0.8) * rc;
      const roll = R2(); const sc = 0.8 + R2() * 2.6; const rot = R2() * 6.283; const fl = 0.55 + R2() * 0.5;
      const h = sampler.height(x, z) - sampler.sea;
      if (h < 0.4) continue;
      const sl = sampler.slope(x, z);
      let p = h < 3 ? 0.04 : 0.015;
      if (forest) p = Math.max(p, 0.06 * sampler._regionWeight(forest, x, z) * Math.min(1, 0.3 + sl));   // pedras soltas entre as arvores
      if (city && sampler._regionWeight(city, x, z) > 0.12) p = 0;
      if (roll < p) out.rocks.push({ x, y: sampler.height(x, z) - sc * 0.25, z, sx: sc, sy: sc * fl, sz: sc * (0.7 + R2() * 0.5), r: rot });
    }
  }

  // ---- predios: um por quarteirao (se o centro do quarteirao cair neste setor)
  if (city) {
    const rr = city.r * 0.92;
    const i0 = Math.floor((x0 - city.x) / CITY_PITCH) - 1; const i1 = Math.ceil((x0 + sector - city.x) / CITY_PITCH) + 1;
    const j0 = Math.floor((z0 - city.z) / CITY_PITCH) - 1; const j1 = Math.ceil((z0 + sector - city.z) / CITY_PITCH) + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const bx = city.x + i * CITY_PITCH + CITY_STREET + (CITY_PITCH - CITY_STREET) / 2;
      const bz = city.z + j * CITY_PITCH + CITY_STREET + (CITY_PITCH - CITY_STREET) / 2;
      if (bx < x0 || bx >= x0 + sector || bz < z0 || bz >= z0 + sector) continue;       // dono: setor do centro
      if (Math.hypot(bx - city.x, bz - city.z) > rr) continue;
      const k = hash(i, j, seed + 303);
      if (k < 0.18) continue;                                                           // terreno baldio
      const cls = Math.min(BUILDING_CLASSES.length - 1, Math.floor(hash(i, j, seed + 404) * BUILDING_CLASSES.length));
      const rot = hash(i, j, seed + 505) < 0.5 ? 0 : Math.PI / 2;
      const c = BUILDING_CLASSES[cls]; const hw = (rot ? c.d : c.w) / 2; const hd = (rot ? c.w : c.d) / 2;
      let y = -1e9; let flat = true; const y0 = sampler.height(bx, bz);
      for (const [dx, dz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) { const hh = sampler.height(bx + dx, bz + dz); if (hh > y) y = hh; if (Math.abs(hh - y0) > 2.4) flat = false; }
      if (!flat) continue;
      out.buildings.push({ x: bx, y, z: bz, cls, r: rot, tint: hash(i, j, seed + 606) });
    }
  }
  return out;
}
