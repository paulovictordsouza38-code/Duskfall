// Visual do helicoptero (modelo GLB, helices girando) e do parapente.
import * as THREE from 'three';
import { buildGLB } from './glb.js';

export const HELI_SCALE = 14;                 // helicoptero grande e bonito (~26 m de comprimento)

export function createHeli(scene, renderer, camera) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const model = new THREE.Group(); model.rotation.y = -Math.PI / 2; model.scale.setScalar(HELI_SCALE); model.visible = true; root.add(model);
  let main = null, tail = null, ready = false;
  fetch('heli.glb').then((r) => r.arrayBuffer()).then((buf) => {
    const { root: r, parts } = buildGLB(buf, renderer);
    model.add(r); main = parts.rotor_main; tail = parts.rotor_tail; ready = true;
    prewarm();
  }).catch(() => { /* sem modelo */ });
  // compila os shaders e envia as texturas para a GPU antes do primeiro uso (evita trava na hora de pular)
  function prewarm() {
    if (!renderer || !camera) return;
    const rv = root.visible;
    root.visible = true;
    try { renderer.compile(scene, camera); } catch (e) { /* ok */ }
    root.visible = rv;
  }
  let inside = false;
  return {
    root,
    get ready() { return ready; },
    show(v) { root.visible = v; },
    setInside(v) { inside = v; },
    set(x, y, z) { root.position.set(x, y, z); },
    update(dt) {
      if (main) main.rotation.y += dt * 34;
      if (tail) tail.rotation.z += dt * 46;
    },
    get inside() { return inside; },
  };
}

// ---- parapente preto: asa curta e curvada (tipo "ram-air"), linhas finas ate o arnes
let _wing = null, _lineMat = null;
function wingGeometry() {
  const NU = 18, NS = 6, HALF = 1.65, CHORD = 1.0, ARC = 0.8, THICK = 0.14;
  const R = HALF / Math.sin(ARC);
  const pos = [], col = [], idx = [];
  const rowOf = (surf, i, j) => (surf * (NU + 1) + i) * (NS + 1) + j;
  for (let surf = 0; surf < 2; surf++) for (let i = 0; i <= NU; i++) {
    const u = i / NU * 2 - 1, th = u * ARC;
    const cx = R * Math.sin(th), cy = R * (Math.cos(th) - 1) * 1.0 + 0.0;
    const taper = 1 - 0.3 * Math.abs(u);                                       // pontas mais estreitas
    for (let j = 0; j <= NS; j++) {
      const s = j / NS;
      const top = surf === 0 ? THICK * taper * Math.sin(Math.PI * Math.pow(s, 0.55)) : 0;
      const z = (s - 0.5) * CHORD * taper;
      pos.push(cx, cy + top, z - Math.abs(u) * 0.12);                          // pontas levemente para tras
      const cell = Math.floor(i / 2) % 2;                                      // celulas alternadas: preto e preto-grafite
      const v = surf === 0 ? (cell ? 0.085 : 0.045) : 0.03;
      col.push(v, v, v * 1.05);
    }
  }
  for (let surf = 0; surf < 2; surf++) for (let i = 0; i < NU; i++) for (let j = 0; j < NS; j++) {
    const a = rowOf(surf, i, j), b = rowOf(surf, i + 1, j), c = rowOf(surf, i, j + 1), d = rowOf(surf, i + 1, j + 1);
    if (surf === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}
export function createChute() {
  if (!_wing) {
    _wing = { geo: wingGeometry(), mat: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) };
    _lineMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
  }
  const g = new THREE.Group();                         // origem = altura dos ombros do personagem
  const wing = new THREE.Mesh(_wing.geo, _wing.mat);
  wing.position.y = 2.1; wing.rotation.x = 0.16; wing.scale.setScalar(1.22);      // borda de ataque um pouco mais alta
  g.add(wing);
  const pts = [];
  const R = 1.65 / Math.sin(0.8);
  for (const s of [0.25, 0.8]) for (let i = 0; i < 7; i++) {
    const u = (i / 6) * 2 - 1, th = u * 0.8;
    const x = 1.22 * R * Math.sin(th), y = 2.1 + 1.22 * R * (Math.cos(th) - 1), z = 1.22 * ((s - 0.5) * (1 - 0.3 * Math.abs(u)) - Math.abs(u) * 0.12);
    pts.push(x, y, z * Math.cos(0.16) - 0.05, Math.sign(x) * 0.3, 0.55, s > 0.5 ? 0.12 : 0.2);   // ate as maos (bracos levantados)
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lg, _lineMat));
  g.position.y = 1.45; g.frustumCulled = false;
  const holder = new THREE.Group(); holder.add(g); holder.visible = false;
  Object.defineProperty(holder, 'chute', { value: g });
  return holder;
}
