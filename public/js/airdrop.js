// Visual do helicoptero (modelo GLB, helices girando), cabine por dentro e paraquedas.
import * as THREE from 'three';
import { buildGLB } from './glb.js';

export const DOOR = { x: 1.05, z: 0.5 };      // onde o jogador fica na cabine (relativo ao helicoptero)

function box(w, h, d, x, y, z, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color }));
  m.position.set(x, y, z); return m;
}

function buildCabin() {
  const g = new THREE.Group();
  const W = 1.45, L = 2.8, H = 2.7;           // meia largura, meio comprimento, altura
  g.add(box(W * 2, 0.1, L * 2, 0, -0.05, 0, 0x2b2f33));            // piso
  g.add(box(W * 2, 0.1, L * 2, 0, H + 0.05, 0, 0x1d2023));         // teto
  g.add(box(0.08, H, L * 2, -W, H / 2, 0, 0x3a4046));              // parede esquerda
  g.add(box(W * 2, H, 0.08, 0, H / 2, L, 0x33383d));               // fundo
  g.add(box(W * 2, 1.0, 0.08, 0, 0.5, -L, 0x33383d));              // frente (baixa, com janela)
  g.add(box(W * 2, 0.9, 0.08, 0, H - 0.45, -L, 0x33383d));
  g.add(box(0.12, H, 0.12, W, H / 2, -L + 0.06, 0x20242a));        // batentes da porta
  g.add(box(0.12, H, 0.12, W, H / 2, L - 0.06, 0x20242a));
  g.add(box(0.14, 0.14, L * 2, W, H - 0.07, 0, 0x20242a));         // viga acima da porta
  g.add(box(0.14, 0.1, L * 2, W, 0.05, 0, 0x20242a));              // soleira
  for (const z of [-1.7, -0.5, 0.7, 1.9]) {                         // bancos na parede esquerda + encosto
    g.add(box(0.5, 0.12, 0.8, -W + 0.3, 0.55, z, 0x15171a));
    g.add(box(0.1, 0.8, 0.8, -W + 0.08, 0.95, z, 0x15171a));
  }
  g.add(box(W * 1.4, 0.12, 0.7, 0, 0.55, L - 0.55, 0x15171a));     // banco do fundo
  g.add(box(W * 1.4, 0.8, 0.1, 0, 0.95, L - 0.12, 0x15171a));
  g.add(box(0.06, 0.06, L * 1.8, -0.3, H - 0.2, 0, 0x55606a));     // barra de segurar no teto
  g.add(box(0.5, 0.05, 0.5, 0, H - 0.02, -0.5, 0xfff2d0));         // luz do teto
  g.add(box(0.5, 0.05, 0.5, 0, H - 0.02, 1.4, 0xfff2d0));
  g.add(box(0.06, 0.5, 0.2, W - 0.2, 0.9, -0.9, 0xc9a227));        // alca/trava amarela
  return g;
}

export function createHeli(scene) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const model = new THREE.Group(); model.rotation.y = -Math.PI / 2; model.scale.setScalar(8); model.visible = false; root.add(model);
  const cabin = buildCabin(); cabin.visible = false; root.add(cabin);
  let main = null, tail = null, ready = false;
  fetch('heli.glb').then((r) => r.arrayBuffer()).then((buf) => {
    const { root: r, parts } = buildGLB(buf);
    model.add(r); main = parts.rotor_main; tail = parts.rotor_tail; ready = true;
  }).catch(() => { /* sem modelo: so a cabine */ });
  let inside = false;
  return {
    root,
    get ready() { return ready; },
    show(v) { root.visible = v; },
    /** dentro: so a cabine (camera la); fora: so o modelo externo */
    setInside(v) { inside = v; cabin.visible = v; model.visible = !v; },
    set(x, y, z) { root.position.set(x, y, z); },
    update(dt) {
      if (main) main.rotation.y += dt * 34;
      if (tail) tail.rotation.z += dt * 46;
    },
    get inside() { return inside; },
  };
}

let _chuteGeo = null, _chuteMat = null, _lineMat = null;
export function createChute() {
  if (!_chuteGeo) {
    _chuteGeo = new THREE.SphereGeometry(1.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    _chuteMat = new THREE.MeshBasicMaterial({ color: 0xd2661f, side: THREE.DoubleSide });
    _lineMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  }
  const g = new THREE.Group();
  const dome = new THREE.Mesh(_chuteGeo, _chuteMat); dome.scale.set(1, 0.55, 1); dome.position.y = 1.7; g.add(dome);
  const pts = [];
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pts.push(Math.cos(a) * 1.55, 1.75, Math.sin(a) * 1.55, 0, 1.2, 0); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(lg, _lineMat));
  g.visible = false; g.frustumCulled = false;
  return g;
}
