// Armas novas (G18, MP5, XM8, FAMAS, SCAR, AWM) e a mira 4x, modeladas por codigo, no mesmo padrao de weapons3d.js:
// +X direita, +Y cima, -Z frente. A ORIGEM e o ponto de mira (ADS): o eixo da mira/luneta passa por ela.
import * as THREE from 'three';
import { roundedBox, cylinderAlong } from './geometry.js';
import { createUSP } from './weapons3d.js';

const cache = new WeakMap();
function mats(lib) {
  if (cache.has(lib)) return cache.get(lib);
  const std = (color, metalness, roughness, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  const M = {
    steel: std(0x3b3f44, 0.9, 0.4), blued: std(0x1f2226, 0.85, 0.42), dark: std(0x090909, 0.2, 0.7),
    polymer: std(0x1a1b1d, 0.05, 0.62), olive: std(0x555a45, 0.1, 0.6), tan: std(0x8d7c56, 0.1, 0.6),
    gray: std(0x6a6d70, 0.15, 0.55), white: std(0xd8d8d0, 0.2, 0.5), wood: std(0x2f4a2d, 0.05, 0.7),
    lens: new THREE.MeshStandardMaterial({ color: 0x1b3a63, metalness: 0.6, roughness: 0.08, emissive: 0x0b2a55, emissiveIntensity: 0.5 }),
    brass: std(0x8a6a2c, 0.9, 0.35),
  };
  cache.set(lib, M);
  return M;
}

function part(geo, mat, x, y, z, parent, rot) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const box = (w, h, d, mat, x, y, z, p, rot, r = 0.004) => part(roundedBox(w, h, d, r), mat, x, y, z, p, rot);
const tube = (axis, r, len, mat, x, y, z, p, seg = 14) => part(cylinderAlong(axis, r, len, seg), mat, x, y, z, p);

/** Luneta curta (2x/4x) com eixo na origem. zFront = ponta da objetiva. */
function scope(M, g, { len = 0.16, r = 0.022, zBack = -0.03, obj = 0.03 }) {
  const zc = zBack - len / 2;
  tube('z', r, len, M.blued, 0, 0, zc, g, 18);
  tube('z', obj, 0.04, M.blued, 0, 0, zBack - len + 0.01, g, 18);             // objetiva
  tube('z', obj * 0.82, 0.006, M.lens, 0, 0, zBack - len - 0.008, g, 18);      // lente
  tube('z', r * 1.25, 0.03, M.blued, 0, 0, zBack - 0.012, g, 18);            // ocular
  box(0.012, 0.016, 0.03, M.steel, 0, -r - 0.004, zBack - 0.04, g);
  box(0.012, 0.016, 0.03, M.steel, 0, -r - 0.004, zBack - len + 0.05, g);
}

function base(M, name) {
  const g = new THREE.Group();
  g.name = name;
  const bolt = new THREE.Group();
  const mag = new THREE.Group();
  g.add(bolt, mag);
  return { g, bolt, mag };
}

function finish(g, bolt, mag, muzzleZ, muzzleY, o) {
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, muzzleY, muzzleZ);
  g.add(muzzle);
  return { group: g, muzzle, parts: { slide: bolt, mag }, ...o };
}

/** G18: pistola Glock automatica com carregador estendido. */
export function createG18(lib) {
  const M = mats(lib);
  const rig = createUSP(lib);
  const g = rig.group;
  g.name = 'G18';
  // ferrolho mais fino e preto, com portas de compensacao; carregador estendido
  const slide = rig.parts.slide;
  for (let i = 0; i < 3; i++) box(0.012, 0.004, 0.012, M.dark, 0, -0.0045, -0.14 - i * 0.016, slide, null, 0.001);
  box(0.006, 0.006, 0.016, M.steel, 0.0165, -0.012, -0.002, g);                // seletor de rajada
  const mag = rig.parts.mag;
  box(0.027, 0.075, 0.046, M.blued, 0, -0.236, 0.0035 + 0.022, mag, [-0.3, 0, 0], 0.005);
  box(0.032, 0.012, 0.05, M.polymer, 0, -0.272, 0.0165 + 0.03, mag, [-0.3, 0, 0], 0.004);
  rig.id = 'g18';
  rig.flashScale = 0.75;
  return rig;
}

/** MP5: submetralhadora com guarda-mao, coronha retratil e carregador curvo. */
export function createMP5(lib) {
  const M = mats(lib);
  const { g, bolt, mag } = base(M, 'MP5');
  box(0.046, 0.058, 0.30, M.blued, 0, -0.045, -0.04, g, null, 0.006);              // receptor
  box(0.04, 0.018, 0.12, M.blued, 0, -0.012, 0.0, g);                              // topo/alca
  box(0.003, 0.012, 0.003, M.dark, -0.006, 0.0035, 0.03, g);
  box(0.003, 0.012, 0.003, M.dark, 0.006, 0.0035, 0.03, g);
  box(0.05, 0.06, 0.2, M.polymer, 0, -0.052, -0.28, g, null, 0.01);                // guarda-mao
  for (let i = 0; i < 5; i++) box(0.052, 0.006, 0.008, M.dark, 0, -0.048, -0.2 - i * 0.032, g, null, 0.001);
  tube('z', 0.0105, 0.12, M.steel, 0, -0.045, -0.43, g, 12);                        // cano
  box(0.006, 0.02, 0.006, M.dark, 0, -0.005, -0.44, g);                             // massa de mira
  tube('z', 0.014, 0.02, M.steel, 0, -0.045, -0.495, g, 12);
  box(0.034, 0.1, 0.044, M.polymer, 0, -0.125, 0.045, g, [-0.35, 0, 0], 0.008);     // empunhadura
  box(0.006, 0.03, 0.06, M.blued, 0.0125, -0.095, -0.015, g);
  box(0.006, 0.03, 0.06, M.blued, -0.0125, -0.095, -0.015, g);
  box(0.028, 0.006, 0.06, M.blued, 0, -0.11, -0.015, g);
  // carregador curvo
  box(0.026, 0.19, 0.05, M.steel, 0, -0.17, -0.1, mag, [0.16, 0, 0], 0.004);
  box(0.03, 0.01, 0.056, M.steel, 0, -0.268, -0.12, mag, [0.16, 0, 0], 0.003);
  // punho de armar e coronha retratil
  tube('x', 0.006, 0.03, M.steel, 0.034, -0.03, -0.12, bolt, 8);
  tube('z', 0.006, 0.2, M.steel, -0.022, -0.05, 0.2, g, 8);
  tube('z', 0.006, 0.2, M.steel, 0.022, -0.05, 0.2, g, 8);
  box(0.04, 0.09, 0.02, M.polymer, 0, -0.07, 0.31, g, [0.1, 0, 0], 0.006);
  return finish(g, bolt, mag, -0.505, -0.045, {
    id: 'mp5', sightHeight: 0.045, eyeDist: 0.42, slideTravel: 0.04,
    grips: { r: { pos: [0.004, -0.105, 0.06], rot: [-0.35, 0, 0] }, l: { pos: [0.0, -0.1, -0.28], rot: [0.1, 0, 0] }, magWell: [0, -0.1, -0.1] },
    carry: { pos: [0.15, 0.17, -0.32], rot: [0, 0, 0] }, flashScale: 0.9, scoped: false,
  });
}

/** XM8: fuzil de polimero com alca de transporte integrada e mira 2x. */
export function createXM8(lib) {
  const M = mats(lib);
  const { g, bolt, mag } = base(M, 'XM8');
  box(0.052, 0.082, 0.34, M.olive, 0, -0.07, -0.06, g, null, 0.014);               // corpo
  box(0.04, 0.03, 0.4, M.polymer, 0, -0.1, -0.33, g, null, 0.01);                  // guarda-mao
  tube('z', 0.011, 0.2, M.steel, 0, -0.075, -0.52, g, 12);                          // cano
  tube('z', 0.018, 0.06, M.blued, 0, -0.075, -0.64, g, 12);                         // apagador de chama
  // alca de transporte com a mira 2x
  box(0.026, 0.05, 0.05, M.olive, 0, -0.03, 0.03, g);
  box(0.026, 0.05, 0.05, M.olive, 0, -0.03, -0.2, g);
  scope(M, g, { len: 0.17, r: 0.021, zBack: -0.03, obj: 0.027 });
  // empunhadura, carregador translucido, coronha
  box(0.036, 0.11, 0.05, M.polymer, 0, -0.16, 0.06, g, [-0.3, 0, 0], 0.01);
  box(0.034, 0.18, 0.06, M.dark, 0, -0.2, -0.07, mag, [0.12, 0, 0], 0.006);
  box(0.04, 0.012, 0.07, M.polymer, 0, -0.295, -0.09, mag, [0.12, 0, 0], 0.004);
  box(0.044, 0.07, 0.3, M.olive, 0, -0.07, 0.34, g, [0.05, 0, 0], 0.012);
  box(0.05, 0.11, 0.03, M.polymer, 0, -0.085, 0.5, g, [0.08, 0, 0], 0.008);
  box(0.012, 0.012, 0.03, M.steel, 0.032, -0.05, -0.02, bolt);                      // alavanca de armar
  return finish(g, bolt, mag, -0.675, -0.075, {
    id: 'xm8', sightHeight: 0.075, eyeDist: 0.34, slideTravel: 0.05,
    grips: { r: { pos: [0.004, -0.17, 0.075], rot: [-0.3, 0, 0] }, l: { pos: [0.0, -0.13, -0.36], rot: [0.1, 0, 0] }, magWell: [0, -0.15, -0.07] },
    carry: { pos: [0.15, 0.15, -0.3], rot: [0, 0, 0] }, flashScale: 1.15, scoped: true,
  });
}

/** FAMAS: bullpup francesa, alca de transporte alta, coronha integrada; aceita mira 4x. */
export function createFAMAS(lib) {
  const M = mats(lib);
  const { g, bolt, mag } = base(M, 'FAMAS');
  box(0.05, 0.1, 0.62, M.olive, 0, -0.085, -0.04, g, null, 0.018);                 // corpo bullpup
  box(0.05, 0.075, 0.12, M.olive, 0, -0.08, 0.31, g, [0.04, 0, 0], 0.014);         // coronha integrada
  box(0.052, 0.09, 0.025, M.polymer, 0, -0.085, 0.385, g, [0.06, 0, 0], 0.008);
  tube('z', 0.012, 0.22, M.steel, 0, -0.085, -0.45, g, 12);
  tube('z', 0.018, 0.05, M.blued, 0, -0.085, -0.57, g, 12);
  // alca de transporte (a mira 2x fica sob ela)
  box(0.018, 0.06, 0.05, M.olive, 0, -0.02, 0.08, g);
  box(0.018, 0.06, 0.05, M.olive, 0, -0.02, -0.26, g);
  box(0.02, 0.012, 0.36, M.olive, 0, 0.012, -0.09, g, null, 0.004);
  scope(M, g, { len: 0.15, r: 0.02, zBack: 0.0, obj: 0.026 });
  // empunhadura na frente do carregador (bullpup)
  box(0.034, 0.105, 0.045, M.polymer, 0, -0.185, -0.08, g, [-0.2, 0, 0], 0.01);
  box(0.03, 0.2, 0.052, M.dark, 0, -0.22, 0.1, mag, [0.1, 0, 0], 0.006);
  box(0.034, 0.012, 0.058, M.polymer, 0, -0.325, 0.115, mag, [0.1, 0, 0], 0.004);
  box(0.012, 0.012, 0.03, M.steel, 0.032, -0.06, -0.1, bolt);
  box(0.03, 0.04, 0.18, M.polymer, 0, -0.14, -0.3, g, null, 0.01);                 // guarda-mao inferior
  return finish(g, bolt, mag, -0.6, -0.085, {
    id: 'famas', sightHeight: 0.085, eyeDist: 0.34, slideTravel: 0.045,
    grips: { r: { pos: [0.004, -0.2, -0.07], rot: [-0.2, 0, 0] }, l: { pos: [0.0, -0.16, -0.31], rot: [0.1, 0, 0] }, magWell: [0, -0.16, 0.1] },
    carry: { pos: [0.15, 0.15, -0.22], rot: [0, 0, 0] }, flashScale: 1.1, scoped: true,
  });
}

/** SCAR-H: fuzil bicolor (preto/areia) com trilho longo, coronha telescopica; aceita mira 4x. */
export function createSCAR(lib) {
  const M = mats(lib);
  const { g, bolt, mag } = base(M, 'SCAR');
  box(0.048, 0.09, 0.3, M.tan, 0, -0.075, -0.05, g, null, 0.01);                   // receptor
  box(0.044, 0.06, 0.36, M.tan, 0, -0.07, -0.37, g, null, 0.008);                  // guarda-mao
  box(0.02, 0.012, 0.62, M.polymer, 0, -0.022, -0.2, g, null, 0.002);              // trilho superior
  for (let i = 0; i < 9; i++) box(0.022, 0.004, 0.012, M.dark, 0, -0.014, -0.05 - i * 0.055, g, null, 0.001);
  tube('z', 0.0115, 0.2, M.steel, 0, -0.07, -0.62, g, 12);
  tube('z', 0.02, 0.07, M.blued, 0, -0.07, -0.69, g, 12);                           // supressor de chama
  scope(M, g, { len: 0.17, r: 0.021, zBack: -0.02, obj: 0.027 });
  box(0.036, 0.11, 0.05, M.polymer, 0, -0.16, 0.07, g, [-0.35, 0, 0], 0.01);
  box(0.034, 0.17, 0.07, M.polymer, 0, -0.18, -0.07, mag, [0.1, 0, 0], 0.006);
  box(0.038, 0.012, 0.075, M.dark, 0, -0.272, -0.085, mag, [0.1, 0, 0], 0.004);
  box(0.04, 0.07, 0.2, M.polymer, 0, -0.06, 0.22, g, [0.04, 0, 0], 0.01);          // coronha telescopica
  box(0.046, 0.12, 0.035, M.polymer, 0, -0.07, 0.34, g, [0.06, 0, 0], 0.008);
  box(0.012, 0.014, 0.03, M.steel, 0.03, -0.05, -0.1, bolt);
  return finish(g, bolt, mag, -0.73, -0.07, {
    id: 'scar', sightHeight: 0.07, eyeDist: 0.34, slideTravel: 0.045,
    grips: { r: { pos: [0.004, -0.17, 0.08], rot: [-0.35, 0, 0] }, l: { pos: [0.0, -0.12, -0.36], rot: [0.1, 0, 0] }, magWell: [0, -0.14, -0.07] },
    carry: { pos: [0.15, 0.15, -0.3], rot: [0, 0, 0] }, flashScale: 1.25, scoped: true,
  });
}

/** AWM: fuzil de precisao ferrolho, coronha verde, cano longo com freio de boca e luneta 8x. */
export function createAWM(lib) {
  const M = mats(lib);
  const { g, bolt, mag } = base(M, 'AWM');
  box(0.046, 0.075, 0.34, M.wood, 0, -0.095, 0.02, g, null, 0.012);                // caixa da culatra
  box(0.04, 0.05, 0.36, M.wood, 0, -0.09, 0.3, g, [0.05, 0, 0], 0.012);           // coronha
  box(0.044, 0.13, 0.04, M.polymer, 0, -0.1, 0.5, g, [0.08, 0, 0], 0.008);        // placa de ombro
  tube('z', 0.0125, 0.9, M.steel, 0, -0.085, -0.5, g, 14);                          // cano longo
  tube('z', 0.02, 0.16, M.blued, 0, -0.085, -0.88, g, 14);                          // freio de boca
  for (let i = 0; i < 3; i++) box(0.045, 0.006, 0.01, M.dark, 0, -0.085, -0.84 - i * 0.04, g, null, 0.001);
  box(0.05, 0.05, 0.5, M.wood, 0, -0.125, -0.28, g, null, 0.012);                  // guarda-mao de madeira/polimero
  // luneta grande 8x
  scope(M, g, { len: 0.3, r: 0.024, zBack: -0.03, obj: 0.04 });
  box(0.02, 0.012, 0.3, M.steel, 0, -0.03, -0.12, g);
  box(0.018, 0.05, 0.03, M.steel, 0, -0.045, -0.06, g);
  box(0.018, 0.05, 0.03, M.steel, 0, -0.045, -0.26, g);
  // empunhadura e carregador
  box(0.034, 0.11, 0.045, M.wood, 0, -0.18, 0.07, g, [-0.3, 0, 0], 0.01);
  box(0.03, 0.04, 0.09, M.steel, 0, -0.16, -0.06, mag, null, 0.004);
  // ferrolho com alavanca (direita)
  tube('x', 0.006, 0.07, M.steel, 0.05, -0.065, -0.02, bolt, 8);
  part(new THREE.SphereGeometry(0.014, 10, 8), M.steel, 0.09, -0.065, -0.02, bolt);
  // bipe dobrado
  tube('z', 0.004, 0.18, M.steel, -0.03, -0.16, -0.62, g, 6);
  tube('z', 0.004, 0.18, M.steel, 0.03, -0.16, -0.62, g, 6);
  return finish(g, bolt, mag, -0.97, -0.085, {
    id: 'awm', sightHeight: 0.085, eyeDist: 0.3, slideTravel: 0.07,
    grips: { r: { pos: [0.004, -0.19, 0.08], rot: [-0.3, 0, 0] }, l: { pos: [0.0, -0.17, -0.34], rot: [0.1, 0, 0] }, magWell: [0, -0.16, -0.06] },
    carry: { pos: [0.15, 0.13, -0.18], rot: [0, 0, 0] }, flashScale: 1.6, scoped: true,
  });
}

/** Mira 4x (item do mapa): luneta com anel luminoso. */
export function createScope4x(lib) {
  const M = mats(lib);
  const g = new THREE.Group();
  g.name = 'mira4x';
  tube('z', 0.04, 0.34, M.blued, 0, 0, 0, g, 18);
  tube('z', 0.058, 0.12, M.blued, 0, 0, -0.2, g, 18);
  tube('z', 0.048, 0.01, M.lens, 0, 0, -0.262, g, 18);
  tube('z', 0.05, 0.08, M.blued, 0, 0, 0.2, g, 18);
  box(0.03, 0.04, 0.06, M.steel, 0, -0.06, -0.05, g);
  box(0.03, 0.04, 0.06, M.steel, 0, -0.06, 0.1, g);
  box(0.07, 0.014, 0.014, M.white, 0, 0.062, -0.05, g);                             // marca "4x"
  return g;
}

export const GUN_BUILDERS = { g18: createG18, mp5: createMP5, xm8: createXM8, famas: createFAMAS, scar: createSCAR, awm: createAWM };
