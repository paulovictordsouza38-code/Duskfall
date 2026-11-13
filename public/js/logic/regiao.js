// Regiao nova do mapa (alem da ravina): ruas, duas pontes, pista de pouso, hangar e 3 galpoes (um aviao por galpao).
// Modulo puro (sem Three.js): devolve caixas visuais, colisores, barris, pontos de loot e zonas planas (para o relevo).
import { makeBox, makeCircle } from './collision.js';

// Aviao de referencia (ainda NAO existe no jogo): 11 m de envergadura, 8,5 m de comprimento, 3 m de altura.
export const PLANE = { span: 11, len: 8.5, h: 3.0 };
// Galpao com tamanho exato: 0,5 m de folga de cada lado do aviao; porta de 11,6 x 3,6 m.
export const GALPAO = { inW: 12, inD: 9.5, inH: 4.0, doorW: 11.6, doorH: 3.6 };
export const GALPAO_X0 = 28.2;                  // face de dentro da porta (x); a porta olha para a pista (oeste)
export const GALPAO_Z = [-214, -240, -266];
export const HANGAR = { x0: -60, x1: -26, z0: -256, z1: -216, h: 10, doorZ0: -249, doorZ1: -223, doorH: 7.5 };
export const RUNWAY = { x0: -10, x1: 10, z0: -290, z1: -175 };
export const RAVINA = { z0: -121, z1: -141 };
export const BRIDGES = [{ cx: 60, w: 7 }, { cx: -66, w: 6 }];
export const T = 0.3;

// ruas (retangulos x0,z0,x1,z1)
const ROADS = [
  [56.5, -84, 63.5, -121], [-69, -84, -63, -121],             // da area antiga ate as pontes
  [-69, -81.5, 63.5, -86.5],                                  // rua transversal atras dos guindastes
  [56.5, -141, 63.5, -160], [-69, -141, -63, -160],           // das pontes ate a rua do norte
  [-69, -157, 63.5, -163],                                    // rua do norte
  [-4, -163, 4, -175],                                        // ligacao com a pista
];
const APRONS = [[10, -280, 28, -200], [-26, -250, -10, -220]];   // patios ao lado da pista
const FLAT_RECTS = [
  ...ROADS.map((r) => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]),
  [RUNWAY.x0, RUNWAY.z0, RUNWAY.x1, RUNWAY.z1],
  ...APRONS,
  [27.5, -273, 39, -207],                                      // galpoes
  [HANGAR.x0 - 1, HANGAR.z0 - 1, HANGAR.x1 + 1, HANGAR.z1 + 1],
];
export const FLAT_ZONES = FLAT_RECTS.map((r) => [r[0], r[1], r[2], r[3], 5]);

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function buildRegiao() {
  const boxes = [];
  const colliders = [];
  const drums = [];
  const loot = [];

  function seg(mat, x0, z0, x1, z1, y0, y1, collide = true, noShoot = false) {
    if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4 || y1 - y0 < 1e-4) return null;
    boxes.push({ mat, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, sx: x1 - x0, sy: y1 - y0, sz: z1 - z0 });
    if (!collide) return null;
    const c = makeBox(x0, z0, x1, z1, y0, y1);
    if (noShoot) c.noShoot = true;
    colliders.push(c);
    return c;
  }
  const flat = (mat, r, y = 0.05) => seg(mat, Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3]), 0, y, false);

  // ---------------------------------------------------------------- ruas, pista, patios
  for (const r of ROADS) flat('asphalt', r, 0.05);
  for (const r of APRONS) flat('asphalt', r, 0.05);
  flat('asphalt', [RUNWAY.x0, RUNWAY.z0, RUNWAY.x1, RUNWAY.z1], 0.06);
  // faixas centrais da pista e cabeceiras
  for (let z = RUNWAY.z0 + 6; z < RUNWAY.z1 - 6; z += 12) seg('mark', -0.3, z, 0.3, z + 6, 0, 0.075, false);
  for (const zz of [RUNWAY.z1 - 4, RUNWAY.z0 + 1]) for (let x = -8; x <= 8; x += 2.4) seg('mark', x - 0.4, zz - 2.5, x + 0.4, zz, 0, 0.075, false);
  seg('mark', RUNWAY.x0 + 0.3, RUNWAY.z0, RUNWAY.x0 + 0.6, RUNWAY.z1, 0, 0.075, false);
  seg('mark', RUNWAY.x1 - 0.6, RUNWAY.z0, RUNWAY.x1 - 0.3, RUNWAY.z1, 0, 0.075, false);
  // faixa amarela das ruas (tracejada)
  for (let x = -66; x < 62; x += 6) seg('mark', x, -84.15, x + 3, -83.85, 0, 0.07, false);
  for (let z = -86; z > -120; z -= 6) { seg('mark', 59.85, z - 3, 60.15, z, 0, 0.07, false); seg('mark', -66.15, z - 3, -65.85, z, 0, 0.07, false); }
  for (let z = -142; z > -158; z -= 6) { seg('mark', 59.85, z - 3, 60.15, z, 0, 0.07, false); seg('mark', -66.15, z - 3, -65.85, z, 0, 0.07, false); }
  for (let x = -66; x < 62; x += 6) seg('mark', x, -159.85, x + 3, -160.15, 0, 0.07, false);

  // ---------------------------------------------------------------- pontes sobre a ravina
  const zA = RAVINA.z0, zB = RAVINA.z1;
  for (const b of BRIDGES) {
    const x0 = b.cx - b.w / 2, x1 = b.cx + b.w / 2;
    seg('asphalt', x0, zB, x1, zA, -0.55, 0.05);                         // tabuleiro (piso a 5 cm: da para subir sem degrau)
    seg('rail', x0, zB, x0 + 0.25, zA, 0.05, 1.05, true, true);          // guarda-corpos (nao seguram bala)
    seg('rail', x1 - 0.25, zB, x1, zA, 0.05, 1.05, true, true);
    for (const pz of [-126, -131, -136]) {
      seg('wall', x0 + 0.5, pz - 0.6, x0 + 1.7, pz + 0.6, -6.3, -0.55);  // pilares
      seg('wall', x1 - 1.7, pz - 0.6, x1 - 0.5, pz + 0.6, -6.3, -0.55);
    }
    seg('wall', x0 + 0.2, zB, x1 - 0.2, zB + 0.5, -0.9, -0.55, false);  // viga de apoio visual
    seg('wall', x0 + 0.2, zA - 0.5, x1 - 0.2, zA, -0.9, -0.55, false);
  }

  // ---------------------------------------------------------------- galpoes (um aviao por galpao)
  const G = GALPAO;
  GALPAO_Z.forEach((cz, gi) => {
    const fx0 = GALPAO_X0 - 0.4, fx1 = GALPAO_X0;                       // parede da frente (porta)
    const bx0 = GALPAO_X0 + G.inD, bx1 = bx0 + 0.3;                     // parede do fundo
    const zi0 = cz - G.inW / 2, zi1 = cz + G.inW / 2;
    seg('metal', fx0, zi0 - T, bx1, zi0, 0, G.inH + T);                 // paredes laterais
    seg('metal', fx0, zi1, bx1, zi1 + T, 0, G.inH + T);
    seg('metal', bx0, zi0, bx1, zi1, 0, G.inH + T);                     // fundo
    seg('metal', fx0, zi0, fx1, cz - G.doorW / 2, 0, G.inH);            // colunas da porta
    seg('metal', fx0, cz + G.doorW / 2, fx1, zi1, 0, G.inH);
    seg('metal', fx0, cz - G.doorW / 2, fx1, cz + G.doorW / 2, G.doorH, G.inH);   // verga
    seg('roof', fx0, zi0 - T, bx1, zi1 + T, G.inH, G.inH + T);          // teto
    seg('mark', fx0 - 0.3, zi0 - T, fx0, zi1 + T, 0, 0.05, false);
    // placa de numero (visual)
    seg('mark', fx0 - 0.05, cz - 0.9, fx0, cz + 0.9, G.inH + 0.35, G.inH + 1.15, false);
    // dentro: 2 barris nos cantos do fundo e 3 pontos de loot nas laterais
    const bx = bx0 - 0.55;
    drums.push({ x: bx, z: zi0 + 0.6 }, { x: bx, z: zi1 - 0.6 });
    loot.push({ x: GALPAO_X0 + 1.0, z: zi0 + 0.9, tier: 'garage' }, { x: GALPAO_X0 + 1.0, z: zi1 - 0.9, tier: 'garage' }, { x: bx0 - 1.6, z: cz, tier: 'garageRare' });
    // pequenas caixas de ferramentas (baixas, de pular)
    seg('junk', bx0 - 0.9, cz - 0.4, bx0 - 0.1, cz + 0.4, 0, 0.55);
  });
  // patios dos galpoes
  loot.push({ x: 20, z: -214, tier: 'path' }, { x: 20, z: -252, tier: 'path' }, { x: 16, z: -272, tier: 'path' });

  // ---------------------------------------------------------------- hangar grande (porta para a pista, no lado leste)
  {
    const H = HANGAR, t = 0.4;
    seg('metal', H.x0, H.z0, H.x1, H.z0 + t, 0, H.h);                  // lado sul
    seg('metal', H.x0, H.z1 - t, H.x1, H.z1, 0, H.h);                  // lado norte
    seg('metal', H.x0, H.z0 + t, H.x0 + t, H.z1 - t, 0, H.h);          // fundo
    seg('metal', H.x1 - t, H.z0 + t, H.x1, H.doorZ0, 0, H.h);          // frente: colunas
    seg('metal', H.x1 - t, H.doorZ1, H.x1, H.z1 - t, 0, H.h);
    seg('metal', H.x1 - t, H.doorZ0, H.x1, H.doorZ1, H.doorH, H.h);    // verga acima da porta
    seg('roof', H.x0, H.z0, H.x1, H.z1, H.h, H.h + 0.4);                // teto
    // tesouras do telhado e colunas internas
    for (let x = H.x0 + 4; x < H.x1; x += 6) seg('rail', x - 0.15, H.z0 + t, x + 0.15, H.z1 - t, H.h - 0.9, H.h, false);
    for (const px of [-52, -38]) for (const pz of [-250, -222]) seg('rail', px - 0.35, pz - 0.35, px + 0.35, pz + 0.35, 0, H.h, true);
    // bancadas e caixotes (baixos)
    seg('junk', H.x0 + 1, H.z0 + 1, H.x0 + 4.5, H.z0 + 2.6, 0, 1.0);
    seg('junk', H.x0 + 1, H.z1 - 2.6, H.x0 + 4.5, H.z1 - 1, 0, 1.0);
    seg('junk', H.x0 + 1, -238, H.x0 + 2.2, -234, 0, 0.7);
    // barris e loot
    drums.push({ x: H.x0 + 1.0, z: H.z0 + 3.4 }, { x: H.x0 + 1.8, z: H.z0 + 3.4 }, { x: H.x0 + 1.0, z: H.z1 - 3.4 }, { x: H.x0 + 1.8, z: H.z1 - 3.4 });
    loot.push({ x: H.x0 + 3, z: -243, tier: 'hangar' }, { x: H.x0 + 3, z: -229, tier: 'hangar' }, { x: -47, z: -236, tier: 'hangarRare' }, { x: -33, z: -243, tier: 'hangar' }, { x: -33, z: -229, tier: 'hangar' }, { x: -55, z: -236, tier: 'hangar' });
  }

  // ---------------------------------------------------------------- barris no caminho ate o hangar (na beira das ruas)
  const path = [
    [54.6, -96], [65.4, -104], [54.8, -112], [-64.5, -99], [-70, -110],           // ruas da area antiga
    [58.2, -148], [64.6, -152], [-64.6, -147], [-68, -153],                        // depois das pontes
    [-30, -165.4], [30, -165.2], [-5.8, -168], [6.5, -172],                        // rua do norte e entrada da pista
    [13, -226], [-12, -232], [15, -262],                                           // patios
  ];
  for (const [x, z] of path) drums.push({ x, z });
  // loot espalhado ao longo do caminho e na pista
  const R = rng(777);
  const spots = [[58, -92], [66, -108], [-65, -95], [-60, -112], [60, -146], [66, -156], [-62, -150], [-68, -158], [-40, -166], [40, -166], [0, -183], [6, -205], [-6, -228], [5, -250], [-5, -272], [20, -232], [-18, -236], [52, -170], [-52, -170], [30, -190]];
  for (const [x, z] of spots) loot.push({ x: x + (R() - 0.5) * 0.4, z: z + (R() - 0.5) * 0.4, tier: 'path' });

  // barris viram colisores do tipo circulo (o cenario liga o desenho e a explosao)
  for (const d of drums) { d.r = 0.32; d.h = 0.9; d.col = makeCircle(d.x, d.z, 0.32, 0, 0.9); }

  return { boxes, colliders, drums, loot };
}
