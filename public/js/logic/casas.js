// Casas e sobrados abandonados (atras dos guindastes). Modulo puro (sem Three.js): devolve caixas visuais,
// colisores e pontos de loot. O cenario so desenha as caixas e o jogo usa os colisores.
//
// Medidas pensadas para as regras de colisao do jogo (STEP_UP 0,3 m, corpo 1,7 m, pulo ~0,9 m):
//  - janela: peitoril a 0,7 m (da para pular) e verga a 2,5 m (cabeca livre em cima do peitoril);
//  - porta: 1,3 m de largura, verga a 2,3 m;
//  - escada: 11 degraus de 0,2909 m (menos que STEP_UP) e 0,28 m de piso;
//  - laje com abertura sobre a escada para nao bater a cabeca.
import { makeBox } from './collision.js';

export const T = 0.3;            // espessura das paredes
export const STOREY = 3.2;       // pe-direito (piso a piso)
export const SLAB = 0.25;        // espessura da laje
export const SILL = 0.7;
export const WIN_TOP = 2.5;
export const DOOR_TOP = 2.3;
export const STEPS = 11;
export const RISE = STOREY / STEPS;
export const RUN = 0.34;       // piso > 0,29 m: o circulo do jogador (r 0,34) nao encosta no degrau seguinte antes de subir
export const STAIR_W = 1.2;
export const PARAPET = 1.2;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function buildCasas() {
  const boxes = [];
  const colliders = [];
  const loot = [];
  const houses = [];

  /** caixa solida: visual + colisor */
  function seg(mat, x0, z0, x1, z1, y0, y1, collide = true) {
    if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4 || y1 - y0 < 1e-4) return;
    boxes.push({ mat, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, sx: x1 - x0, sy: y1 - y0, sz: z1 - z0 });
    if (collide) colliders.push(makeBox(x0, z0, x1, z1, y0, y1));
  }

  /** parede ao longo de X: [xa,xb] x [zmin, zmin+T], com aberturas [{a,b,k:'d'|'w'}] */
  function wallX(mat, xa, xb, zmin, y0, ops, h = STOREY) {
    let cur = xa;
    for (const o of ops.slice().sort((p, q) => p.a - q.a)) {
      seg(mat, cur, zmin, o.a, zmin + T, y0, y0 + h);
      if (o.k === 'd') seg(mat, o.a, zmin, o.b, zmin + T, y0 + DOOR_TOP, y0 + h);
      else { seg(mat, o.a, zmin, o.b, zmin + T, y0, y0 + SILL); seg(mat, o.a, zmin, o.b, zmin + T, y0 + WIN_TOP, y0 + h); }
      cur = o.b;
    }
    seg(mat, cur, zmin, xb, zmin + T, y0, y0 + h);
  }
  /** parede ao longo de Z: [xmin, xmin+T] x [za,zb] */
  function wallZ(mat, za, zb, xmin, y0, ops, h = STOREY) {
    let cur = za;
    for (const o of ops.slice().sort((p, q) => p.a - q.a)) {
      seg(mat, xmin, cur, xmin + T, o.a, y0, y0 + h);
      if (o.k === 'd') seg(mat, xmin, o.a, xmin + T, o.b, y0 + DOOR_TOP, y0 + h);
      else { seg(mat, xmin, o.a, xmin + T, o.b, y0, y0 + SILL); seg(mat, xmin, o.a, xmin + T, o.b, y0 + WIN_TOP, y0 + h); }
      cur = o.b;
    }
    seg(mat, xmin, cur, xmin + T, zb, y0, y0 + h);
  }
  /** laje com uma abertura (hole = [x0,z0,x1,z1], dentro da laje) */
  function slab(mat, x0, z0, x1, z1, top, hole) {
    const y0 = top - SLAB;
    if (!hole) { seg(mat, x0, z0, x1, z1, y0, top); return; }
    const [hx0, hz0, hx1, hz1] = hole;
    seg(mat, x0, z0, hx0, z1, y0, top);
    seg(mat, hx1, z0, x1, z1, y0, top);
    seg(mat, hx0, z0, hx1, hz0, y0, top);
    seg(mat, hx0, hz1, hx1, z1, y0, top);
  }
  /** escada de 11 degraus. dir = +1 / -1 ao longo de X, start = x do primeiro degrau, baseY = piso, z0..z0+STAIR_W */
  function stairX(start, dir, z0, baseY) {
    for (let i = 0; i < STEPS; i++) {
      const a = start + dir * i * RUN;
      const b = start + dir * (i + 1) * RUN;
      seg('step', Math.min(a, b), z0, Math.max(a, b), z0 + STAIR_W, baseY, baseY + (i + 1) * RISE);
    }
  }

  /**
   * Uma casa. cx, cz = centro. floors 1 (casa) ou 2 (sobrado). face = +1 (porta para +z) ou -1.
   */
  function house(cx, cz, floors, face, brick, seed) {
    const R = rng(seed);
    const W = floors === 2 ? 9 : 8;
    const D = floors === 2 ? 7 : 6;
    const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
    const wm = brick ? 'brick' : 'wall';
    const info = { cx, cz, floors, x0, x1, z0, z1, doors: [], windows: [] };
    const front = face > 0 ? z1 - T : z0;     // parede da frente (porta)
    const back = face > 0 ? z0 : z1 - T;
    const jit = () => (R() - 0.5) * 1.2;

    // ---- terreo: frente com porta + janela(s); fundo com janelas; laterais com janela
    const dx = cx + (R() < 0.5 ? -1 : 1) * (1.4 + R() * 0.8);
    const frontOps = [{ a: dx - 0.65, b: dx + 0.65, k: 'd' }];
    const wx = dx > cx ? cx - 2.6 + jit() * 0.4 : cx + 2.6 + jit() * 0.4;
    frontOps.push({ a: wx - 0.7, b: wx + 0.7, k: 'w' });
    wallX(wm, x0, x1, front, 0, frontOps);
    // fundo: janelas longe da escada (que fica do lado esquerdo, encostada na parede)
    const backOps = [{ a: cx + 1.2 - 0.7, b: cx + 1.2 + 0.7, k: 'w' }, { a: cx + 3.0 - 0.65, b: cx + 3.0 + 0.65, k: R() < 0.5 ? 'd' : 'w' }];
    wallX(wm, x0, x1, back, 0, backOps);
    const zc = cz + jit() * 0.5;
    wallZ(wm, z0 + T, z1 - T, x0, 0, [{ a: zc - 0.7, b: zc + 0.7, k: 'w' }]);
    wallZ(wm, z0 + T, z1 - T, x1 - T, 0, R() < 0.5 ? [{ a: zc - 0.7, b: zc + 0.7, k: 'w' }] : [{ a: zc - 0.65, b: zc + 0.65, k: 'd' }]);
    info.frontDoor = { x: dx, z: front + T / 2, face };

    if (floors === 1) {
      // teto: metade caiu (so cobre o lado esquerdo) + um bloco de laje caido no chao
      slab('slab', x0, z0, cx + 0.2, z1, STOREY, null);
      if (face > 0) seg('slab', cx + 1.6, cz - 1.5, cx + 3.6, cz - 0.4, 0, 0.5); else seg('slab', cx + 1.6, cz + 0.4, cx + 3.6, cz + 1.5, 0, 0.5);
      // meia parede interna com vao
      if (face > 0) wallZ(wm, z0 + T, cz - 0.6, cx - 0.8, 0, [], 2.4); else wallZ(wm, cz + 0.6, z1 - T, cx - 0.8, 0, [], 2.4);
    } else {
      // ---- escada 1 (terreo -> andar), encostada na parede do fundo, subindo para +x
      const zBack = face > 0 ? z0 + T : z1 - T - STAIR_W;
      const s1 = x0 + T + 0.9;      // 0,9 m livres antes do 1o degrau (de onde se entra)
      stairX(s1, +1, zBack, 0);
      const hx0 = s1 + 2 * RUN, hx1 = s1 + STEPS * RUN;
      const hz0 = face > 0 ? zBack : zBack - 0.5, hz1 = face > 0 ? zBack + STAIR_W + 0.5 : zBack + STAIR_W;
      slab('slab', x0 + T, z0 + T, x1 - T, z1 - T, STOREY, [hx0, hz0, hx1, hz1]);
      info.stair1 = { x: s1, z: zBack + STAIR_W / 2, dir: +1, top: [s1 + STEPS * RUN, zBack + STAIR_W / 2] };

      // ---- andar de cima
      const y2 = STOREY;
      const fOps = [{ a: cx - 2.8 - 0.7, b: cx - 2.8 + 0.7, k: 'w' }, { a: cx + 0.3 - 0.7, b: cx + 0.3 + 0.7, k: 'w' }, { a: cx + 2.8 - 0.7, b: cx + 2.8 + 0.7, k: 'w' }];
      wallX(wm, x0, x1, front, y2, fOps);
      wallX(wm, x0, x1, back, y2, [{ a: cx - 1.2, b: cx + 0.2, k: 'w' }, { a: cx + 2.4, b: cx + 3.6, k: 'w' }]);
      wallZ(wm, z0 + T, z1 - T, x0, y2, [{ a: cz - 0.7, b: cz + 0.7, k: 'w' }]);
      wallZ(wm, z0 + T, z1 - T, x1 - T, y2, [{ a: cz - 0.7, b: cz + 0.7, k: 'w' }]);
      // ---- escada 2 (andar -> laje), encostada na parede da frente, subindo para -x
      const zFront = face > 0 ? z1 - T - STAIR_W : z0 + T;
      const s2 = x1 - T - 0.9;
      stairX(s2, -1, zFront, y2);
      const gx0 = s2 - STEPS * RUN, gx1 = s2 - 2 * RUN;
      const gz0 = face > 0 ? zFront - 0.5 : zFront, gz1 = face > 0 ? zFront + STAIR_W : zFront + STAIR_W + 0.5;
      const roof = STOREY * 2;
      slab('slab', x0, z0, x1, z1, roof, [gx0, gz0, gx1, gz1]);
      info.stair2 = { x: s2, z: zFront + STAIR_W / 2, dir: -1, top: [s2 - STEPS * RUN, zFront + STAIR_W / 2] };
      // platibanda
      const ph = roof + PARAPET;
      seg('wall', x0, z0, x1, z0 + T * 0.8, roof, ph);
      seg('wall', x0, z1 - T * 0.8, x1, z1, roof, ph);
      seg('wall', x0, z0 + T * 0.8, x0 + T * 0.8, z1 - T * 0.8, roof, ph);
      seg('wall', x1 - T * 0.8, z0 + T * 0.8, x1, z1 - T * 0.8, roof, ph);
      // loot: andar de cima e laje
      loot.push({ x: cx + 2.5, y: y2, z: cz + (face > 0 ? -1.0 : 1.0), tier: 'up', house: houses.length });
      loot.push({ x: cx - 1.8, y: roof, z: cz + 0.6, tier: 'roof', house: houses.length });
    }
    // entulho (baixo, da para pular) e itens do terreo
    const junk = [[cx + 2.7, cz + (face > 0 ? -1.4 : 1.4), 0.7, 0.5, 0.6], [cx + 0.2, cz + (face > 0 ? 1.0 : -1.0), 0.5, 0.45, 0.5]];
    for (const [jx, jz, sx, sy, sz] of junk) {
      if (floors === 1 && jx > cx + 1.4 && Math.abs(jz - cz) < 1.6) continue;
      seg('junk', jx - sx / 2, jz - sz / 2, jx + sx / 2, jz + sz / 2, 0, sy);
    }
    loot.push({ x: cx - 2.2, y: 0, z: cz + (face > 0 ? 1.4 : -1.4), tier: 'ground', house: houses.length });
    houses.push(info);
  }

  // Linha de tras (z -112) e da frente (z -93), sempre fora da base dos guindastes (x -8..14, z -108..-88)
  const rowA = [-58, -44, -30, -17, 24, 37, 50];
  const rowB = [-58, -42, -21, -10, 6, 28, 46];
  let n = 0;
  rowA.forEach((x, i) => { house(x, -93, i % 3 === 1 ? 1 : 2, i % 2 ? -1 : 1, i % 2 === 0, 7100 + n++); });
  rowB.forEach((x, i) => { house(x, -112, i % 3 === 2 ? 1 : 2, 1, i % 2 === 1, 7100 + n++); });

  return { boxes, colliders, loot, houses };
}
