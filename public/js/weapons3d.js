// Modelos 3D das duas armas, construidos por codigo (provisorios, mas com pecas reais:
// ferrolho, carregador, empunhadura, gatilho, mira). Podem ser substituidos por .glb (ver README).
//
// Referencial local da arma: +X direita, +Y cima, -Z frente (boca do cano).
// A ORIGEM e o ponto da MIRA TRASEIRA: na mira (ADS) a camera enxerga por este ponto.
import * as THREE from 'three';
import { roundedBox, cylinderAlong } from './geometry.js';

function mats(lib) {
  const fabric = lib.fabric();
  const stipple = fabric.normalMap.clone();
  stipple.repeat.set(6, 6);
  stipple.needsUpdate = true;
  return {
    slide: new THREE.MeshStandardMaterial({ color: 0x2b2e32, metalness: 0.9, roughness: 0.34 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3b3f44, metalness: 0.9, roughness: 0.4 }),
    blued: new THREE.MeshStandardMaterial({ color: 0x1f2226, metalness: 0.85, roughness: 0.42 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.05, roughness: 0.62, normalMap: stipple, normalScale: new THREE.Vector2(0.8, 0.8) }),
    bakelite: new THREE.MeshStandardMaterial({ color: 0x151412, metalness: 0.05, roughness: 0.42 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x090909, metalness: 0.2, roughness: 0.7 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x8a6a2c, metalness: 0.9, roughness: 0.35 }),
    sightDot: new THREE.MeshStandardMaterial({ color: 0xd8d8d0, emissive: 0x888880, emissiveIntensity: 0.6, roughness: 0.5 }),
  };
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

/** Pistola USP (familia H&K): ferrolho (slide), armacao, empunhadura, gatilho e carregador. */
export function createUSP(lib) {
  const M = mats(lib);
  const g = new THREE.Group();
  g.name = 'USP';

  // ferrolho (anima no disparo e na recarga)
  const slide = new THREE.Group();
  g.add(slide);
  part(roundedBox(0.031, 0.034, 0.205, 0.006), M.slide, 0, -0.022, -0.065, slide);
  part(roundedBox(0.0125, 0.012, 0.012, 0.002), M.dark, 0, 0.0, 0.025, slide);                 // mira traseira
  part(new THREE.BoxGeometry(0.0035, 0.0035, 0.004), M.sightDot, -0.004, 0.0015, 0.0195, slide);
  part(new THREE.BoxGeometry(0.0035, 0.0035, 0.004), M.sightDot, 0.004, 0.0015, 0.0195, slide);
  part(roundedBox(0.006, 0.011, 0.012, 0.002), M.dark, 0, -0.0045, -0.150, slide);             // massa de mira
  part(new THREE.BoxGeometry(0.0035, 0.0035, 0.004), M.sightDot, 0, -0.001, -0.150, slide);
  for (let i = 0; i < 5; i++) {                                                                 // serrilhas
    for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.002, 0.026, 0.0035), M.dark, sx * 0.0158, -0.022, 0.012 - i * 0.0075, slide);
  }
  part(new THREE.BoxGeometry(0.003, 0.012, 0.03), M.dark, 0.0155, -0.018, -0.055, slide);       // janela de ejecao
  part(cylinderAlong('z', 0.0075, 0.012, 12), M.steel, 0, -0.035, -0.174, slide);               // boca do cano

  // armacao e guarda-mato
  part(roundedBox(0.029, 0.026, 0.150, 0.006), M.polymer, 0, -0.050, -0.058, g);
  part(roundedBox(0.012, 0.012, 0.045, 0.003), M.steel, 0, -0.063, -0.12, g);                   // trilho
  part(roundedBox(0.0045, 0.03, 0.062, 0.002), M.polymer, 0, -0.077, -0.058, g).position.x = 0.0125; // guarda-mato (lado)
  part(roundedBox(0.0045, 0.03, 0.062, 0.002), M.polymer, -0.0125, -0.077, -0.058, g);
  part(roundedBox(0.028, 0.006, 0.07, 0.002), M.polymer, 0, -0.091, -0.075, g);                 // guarda-mato (frente)
  part(roundedBox(0.008, 0.026, 0.01, 0.002), M.blued, 0, -0.07, -0.048, g, [0.25, 0, 0]);      // gatilho
  part(roundedBox(0.006, 0.01, 0.022, 0.002), M.blued, 0.0165, -0.036, -0.008, g);              // trava/alavanca
  part(roundedBox(0.0045, 0.016, 0.01, 0.002), M.blued, 0.0165, -0.056, -0.034, g);            // retem do carregador

  // empunhadura inclinada
  const grip = part(roundedBox(0.033, 0.112, 0.056, 0.008), M.polymer, 0, -0.112, 0.012, g, [-0.30, 0, 0]);
  grip.name = 'empunhadura';
  part(roundedBox(0.026, 0.05, 0.004, 0.001), M.blued, 0, -0.095, 0.036, g, [-0.30, 0, 0]);    // placa traseira

  // carregador (anima na recarga)
  const mag = new THREE.Group();
  mag.position.set(0, 0, 0);
  g.add(mag);
  part(roundedBox(0.027, 0.075, 0.046, 0.005), M.blued, 0, -0.165, 0.0035, mag, [-0.30, 0, 0]);
  part(roundedBox(0.032, 0.012, 0.05, 0.004), M.polymer, 0, -0.1985, 0.0155, mag, [-0.30, 0, 0]); // base

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.034, -0.182);
  g.add(muzzle);

  return {
    id: 'usp',
    group: g,
    muzzle,
    parts: { slide, mag },
    sightHeight: 0.034,       // altura da mira acima do eixo do cano
    eyeDist: 0.46,            // distancia olho -> mira traseira em ADS
    slideTravel: 0.03,
    // pontos de empunhadura no referencial da arma (pulso das maos)
    grips: {
      r: { pos: [0.004, -0.060, 0.040], rot: [-0.30, 0, 0] },
      l: { pos: [-0.036, -0.075, 0.070], rot: [1.15, 0, 0] },
      magWell: [0, -0.10, 0.012],
    },
    carry: { pos: [0.12, 0.20, -0.40], rot: [0, 0, 0] },
    flashScale: 0.7,
  };
}

/** Submetralhadora MP40: tubo receptor, carregador longo vertical, coronha dobravel aberta. */
export function createMP40(lib) {
  const M = mats(lib);
  const g = new THREE.Group();
  g.name = 'MP40';

  // receptor tubular
  part(cylinderAlong('z', 0.030, 0.31, 18), M.blued, 0, -0.042, -0.065, g);
  part(roundedBox(0.056, 0.05, 0.09, 0.008), M.blued, 0, -0.065, 0.0, g);                       // caixa do gatilho
  part(roundedBox(0.044, 0.022, 0.15, 0.006), M.blued, 0, -0.012, 0.02, g);                     // tampa superior
  // cano e camisa ventilada
  part(cylinderAlong('z', 0.0105, 0.15, 12), M.steel, 0, -0.042, -0.31, g);
  const shroud = part(cylinderAlong('z', 0.0185, 0.2, 18), M.blued, 0, -0.042, -0.285, g);
  shroud.name = 'camisa';
  for (let i = 0; i < 7; i++) {
    part(new THREE.BoxGeometry(0.01, 0.003, 0.008), M.dark, 0, -0.0235, -0.225 - i * 0.022, g);
    for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.003, 0.01, 0.008), M.dark, sx * 0.0186, -0.042, -0.225 - i * 0.022, g);
  }
  part(cylinderAlong('z', 0.0125, 0.018, 12), M.steel, 0, -0.042, -0.395, g);                  // freio/boca
  // miras: massa de mira em capuz e alca traseira
  part(roundedBox(0.026, 0.026, 0.014, 0.003), M.blued, 0, -0.012, -0.375, g);                  // capuz
  part(new THREE.BoxGeometry(0.003, 0.014, 0.003), M.sightDot, 0, 0.0, -0.375, g);               // massa de mira (topo em y~0.007)
  part(roundedBox(0.03, 0.012, 0.014, 0.002), M.steel, 0, -0.0035, 0.025, g);                    // base alca traseira
  part(new THREE.BoxGeometry(0.003, 0.012, 0.003), M.dark, -0.006, 0.0035, 0.025, g);
  part(new THREE.BoxGeometry(0.003, 0.012, 0.003), M.dark, 0.006, 0.0035, 0.025, g);

  // ferrolho/punho de armar (anima)
  const bolt = new THREE.Group();
  g.add(bolt);
  part(cylinderAlong('x', 0.007, 0.032, 10), M.steel, 0.040, -0.040, -0.05, bolt);
  part(new THREE.SphereGeometry(0.0105, 12, 8), M.steel, 0.060, -0.040, -0.05, bolt);
  part(new THREE.BoxGeometry(0.003, 0.004, 0.14), M.dark, 0.0295, -0.040, -0.03, g);             // fenda do punho

  // empunhadura de baquelite
  const grip = part(roundedBox(0.034, 0.105, 0.048, 0.01), M.bakelite, 0, -0.14, 0.055, g, [-0.35, 0, 0]);
  grip.name = 'empunhadura';
  // guarda-mato e gatilho
  part(roundedBox(0.006, 0.034, 0.062, 0.002), M.blued, 0.0135, -0.105, 0.003, g);
  part(roundedBox(0.006, 0.034, 0.062, 0.002), M.blued, -0.0135, -0.105, 0.003, g);
  part(roundedBox(0.028, 0.006, 0.062, 0.002), M.blued, 0, -0.121, 0.003, g);
  part(roundedBox(0.008, 0.026, 0.01, 0.002), M.steel, 0, -0.1, 0.018, g, [0.2, 0, 0]);

  // carregador longo (anima)
  const mag = new THREE.Group();
  g.add(mag);
  part(roundedBox(0.04, 0.052, 0.088, 0.006), M.blued, 0, -0.098, -0.044, g);                    // alojamento fixo
  part(roundedBox(0.025, 0.205, 0.068, 0.004), M.steel, 0, -0.205, -0.044, mag);
  for (let i = 0; i < 5; i++) part(new THREE.BoxGeometry(0.0268, 0.003, 0.07), M.dark, 0, -0.14 - i * 0.03, -0.044, mag);
  part(roundedBox(0.03, 0.01, 0.075, 0.003), M.steel, 0, -0.311, -0.044, mag);

  // coronha dobravel aberta (tubos + chapa)
  const rodGeo = cylinderAlong('z', 0.0055, 0.23, 8);
  part(rodGeo, M.steel, -0.026, -0.052, 0.2, g);
  part(rodGeo, M.steel, 0.026, -0.052, 0.2, g);
  part(roundedBox(0.062, 0.006, 0.006, 0.002), M.steel, 0, -0.056, 0.31, g);
  part(roundedBox(0.012, 0.115, 0.018, 0.004), M.steel, 0, -0.092, 0.322, g, [0.14, 0, 0]);
  part(roundedBox(0.016, 0.1, 0.01, 0.003), M.dark, 0, -0.092, 0.333, g, [0.14, 0, 0]);
  part(roundedBox(0.03, 0.012, 0.03, 0.003), M.steel, 0, -0.05, 0.095, g);                       // dobradica da coronha

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.042, -0.405);
  g.add(muzzle);

  return {
    id: 'mp40',
    group: g,
    muzzle,
    parts: { slide: bolt, mag },
    sightHeight: 0.042,
    eyeDist: 0.42,
    slideTravel: 0.045,
    grips: {
      r: { pos: [0.004, -0.115, 0.075], rot: [-0.35, 0, 0] },
      l: { pos: [0.0, -0.155, -0.040], rot: [0.1, 0, 0.0] },   // segura o alojamento do carregador
      magWell: [0, -0.11, -0.044],
    },
    carry: { pos: [0.15, 0.17, -0.34], rot: [0, 0, 0] },
    flashScale: 1.0,
  };
}
