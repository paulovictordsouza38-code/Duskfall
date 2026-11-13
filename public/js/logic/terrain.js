// Relevo do mapa: funcao pura terrainHeight(x, z) (altura do chao em metros). Sem Three.js, entao da para testar no Node.
// - morros: elevacoes suaves; barrancos: valas/ravinas; a ravina grande separa a area antiga da regiao nova (pontes).
// - Tudo que e construido (casas, estruturas, ruas, pista, galpoes) fica em area PLANA (mascara): altura 0.
import { FLAT_ZONES } from './regiao.js';

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** perfil suave: 1 no centro, 0 na borda */
const bell = (d, r) => (d >= r ? 0 : 0.5 * (1 + Math.cos(Math.PI * d / r)));

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

// morros (x, z, raio, altura)
export const HILLS = [
  [40, -48, 6, 2.8], [-18, -60, 6, 2.6], [18, -62, 5.5, 2.4], [-62, -64, 5.5, 2.8], [62, -30, 5.5, 2.2], [-38, -52, 5.5, 2.4],
  [-45, -190, 8, 3.0], [42, -178, 7, 2.5], [-42, -283, 9, 3.5], [44, -292, 8, 3.0],
];
// cristas / barrancos altos (segmento x0,z0,x1,z1, largura (raio), altura)
export const RIDGES = [
  [-63, -180, -63, -206, 8, 4.5],
  [65, -186, 65, -292, 9, 5.5],
  [-60, -300, 60, -300, 8, 4.0],
];
// valas (barrancos para baixo): x0,z0,x1,z1, raio, profundidade
export const TRENCHES = [
  [-40, -103.5, -12, -103.5, 3.2, 2.0],       // vala entre as fileiras de casas
];
// ravina grande (atravessa todo o mapa): pontes ligam os dois lados
export const RAVINE = { z0: -121, z1: -141, depth: 6 };

function flatMask(x, z) {
  let m = 1;
  for (const f of FLAT_ZONES) {
    const dx = Math.max(f[0] - x, 0, x - f[2]);
    const dz = Math.max(f[1] - z, 0, z - f[3]);
    const d = Math.hypot(dx, dz);
    if (d < f[4]) m *= smooth(d / f[4]);
    if (m <= 0) return 0;
  }
  return m;
}

export function terrainHeight(x, z) {
  if (x < -86 || x > 86 || z > -17 || z < -312) return 0;
  let h = 0;
  for (const [cx, cz, r, hh] of HILLS) {
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < r * r) h += hh * bell(Math.hypot(dx, dz), r);
  }
  for (const [x0, z0, x1, z1, r, hh] of RIDGES) h += hh * bell(segDist(x, z, x0, z0, x1, z1), r);
  for (const [x0, z0, x1, z1, r, d] of TRENCHES) if (r > 0) h -= d * bell(segDist(x, z, x0, z0, x1, z1), r);
  h *= flatMask(x, z);
  // ravina: sem mascara (as ruas terminam exatamente nas bordas e as pontes passam por cima)
  const rz = (z - RAVINE.z0) / (RAVINE.z1 - RAVINE.z0);
  if (rz > 0 && rz < 1) h -= RAVINE.depth * 0.5 * (1 - Math.cos(2 * Math.PI * rz));
  return h;
}

/** Malha do chao: posicoes, indices e cores "assadas" (luz fixa). Devolve typed arrays; sem Three.js. */
export function buildTerrainGrid(x0, x1, z0, z1, cell) {
  const nx = Math.round((x1 - x0) / cell), nz = Math.round((z1 - z0) / cell);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const H = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
    H[j * (nx + 1) + i] = terrainHeight(x, z);
  }
  const L = [-0.35, 0.72, -0.6]; { const n = Math.hypot(...L); L[0] /= n; L[1] /= n; L[2] /= n; }
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = j * (nx + 1) + i;
    const x = x0 + (x1 - x0) * i / nx, z = z0 + (z1 - z0) * j / nz;
    const hL = H[j * (nx + 1) + Math.max(0, i - 1)], hR = H[j * (nx + 1) + Math.min(nx, i + 1)];
    const hD = H[Math.max(0, j - 1) * (nx + 1) + i], hU = H[Math.min(nz, j + 1) * (nx + 1) + i];
    const sx = (hR - hL) / (((Math.min(nx, i + 1) - Math.max(0, i - 1)) * (x1 - x0)) / nx);
    const sz = (hU - hD) / (((Math.min(nz, j + 1) - Math.max(0, j - 1)) * (z1 - z0)) / nz);
    const nl = Math.hypot(sx, 1, sz);
    const nxn = -sx / nl, nyn = 1 / nl, nzn = -sz / nl;
    const lam = Math.max(0, nxn * L[0] + nyn * L[1] + nzn * L[2]);
    const flat = L[1];                        // brilho do chao plano
    const shade = 1 + (lam - flat) * 1.5;     // encostas viradas ao sol clareiam, as de sombra escurecem
    const h = H[k];
    const tint = h < -0.4 ? 0.78 : 1 + Math.min(0.25, h * 0.04);   // fundo da ravina mais escuro, topos mais claros
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 10.5; uv[k * 2 + 1] = z / 10.5;
    const s = Math.max(0.45, shade * tint);
    col[k * 3] = s; col[k * 3 + 1] = s * 0.97; col[k * 3 + 2] = s * 0.94;
  }
  const idx = new Uint32Array(nx * nz * 6);
  let q = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + (nx + 1), d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  return { pos, uv, col, idx };
}

/**
 * Altura EXATA da malha desenhada (interpola os mesmos triangulos de buildTerrainGrid). O jogador, bots, itens e tiros
 * usam esta funcao, entao o chao nunca fica "afundado" ou "flutuando" em relacao ao que se ve.
 */
export function makeTerrainSurface(x0, x1, z0, z1, cell) {
  const nx = Math.round((x1 - x0) / cell), nz = Math.round((z1 - z0) / cell);
  const H = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) H[j * (nx + 1) + i] = terrainHeight(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz);
  return (x, z) => {
    if (x <= x0 || x >= x1 || z <= z0 || z >= z1) return terrainHeight(x, z);
    const fx = (x - x0) / (x1 - x0) * nx, fz = (z - z0) / (z1 - z0) * nz;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= nx) i = nx - 1; if (j >= nz) j = nz - 1;
    const u = fx - i, v = fz - j;
    const a = H[j * (nx + 1) + i], b = H[j * (nx + 1) + i + 1], c = H[(j + 1) * (nx + 1) + i], d = H[(j + 1) * (nx + 1) + i + 1];
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
  };
}
