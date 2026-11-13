// Visual do helicoptero (modelo GLB, helices girando), cabine por dentro e parapente.
import * as THREE from 'three';
import { buildGLB } from './glb.js';
import { CABIN } from './logic/airdrop.js';

const MAT = new Map();
function mat(color) {
  let m = MAT.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); MAT.set(color, m); }
  return m;
}
function box(w, h, d, x, y, z, color, m) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat(color));
  o.position.set(x, y, z); return o;
}
function cyl(r, len, x, y, z, color, axis = 'y', seg = 8) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat(color));
  o.position.set(x, y, z);
  if (axis === 'x') o.rotation.z = Math.PI / 2; else if (axis === 'z') o.rotation.x = Math.PI / 2;
  return o;
}

/** textura simples desenhada em canvas (se nao houver canvas, devolve null e fica a cor lisa) */
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  try {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); if (!g) return null;
    draw(g, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch (e) { return null; }
}
function texMat(tex, fallback) { return tex ? new THREE.MeshBasicMaterial({ map: tex }) : mat(fallback); }

/** junta as pecas fixas da cabine em poucas malhas (1 por textura + 1 de cor com cores por vertice): bem menos chamadas de desenho */
function mergeStatic(g) {
  const groups = new Map();
  for (const c of [...g.children]) {
    if (!c.isMesh || c.material.transparent) continue;
    const key = c.material.map ? c.material : 'color';
    let a = groups.get(key); if (!a) { a = []; groups.set(key, a); }
    a.push(c); g.remove(c);
  }
  for (const [key, list] of groups) {
    const tex = key !== 'color';
    let n = 0; const geos = list.map((c) => { c.updateMatrix(); const ge = c.geometry.clone().applyMatrix4(c.matrix); const ni = ge.index ? ge.toNonIndexed() : ge; n += ni.attributes.position.count; return ni; });
    const pos = new Float32Array(n * 3), uv = tex ? new Float32Array(n * 2) : null, col = tex ? null : new Float32Array(n * 3);
    let o = 0;
    geos.forEach((ge, i) => {
      const cnt = ge.attributes.position.count;
      pos.set(ge.attributes.position.array, o * 3);
      if (tex) uv.set(ge.attributes.uv.array, o * 2);
      else { const cc = list[i].material.color; for (let k = 0; k < cnt; k++) { col[(o + k) * 3] = cc.r; col[(o + k) * 3 + 1] = cc.g; col[(o + k) * 3 + 2] = cc.b; } }
      o += cnt;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (tex) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); else geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, tex ? key : new THREE.MeshBasicMaterial({ vertexColors: true }));
    m.frustumCulled = false;
    g.add(m);
  }
}

function buildCabin() {
  const g = new THREE.Group();
  const { W, L, H } = CABIN;
  // ---- materiais com textura
  const plate = canvasTex(128, 128, (c, w, h) => {                       // piso de aluminio quadriculado (diamante)
    c.fillStyle = '#3c4044'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      c.fillStyle = '#5a6066'; c.save(); c.translate(x + 8, y + 8); c.rotate(((x + y) / 16 % 2) ? 0.78 : -0.78); c.fillRect(-5, -1.5, 10, 3); c.restore();
    }
  }, 3.2, 7);
  const panel = canvasTex(128, 128, (c, w, h) => {                       // forro de parede (verde oliva escuro com emendas)
    c.fillStyle = '#2f352b'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1b1f18'; c.lineWidth = 3; c.strokeRect(2, 2, w - 4, h - 4);
    c.fillStyle = '#3a4234'; c.fillRect(8, 8, w - 16, h - 16);
    for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(0,0,0,0.05)'; c.fillRect(Math.random() * w, Math.random() * h, 12, 2); }
  }, 3, 1);
  const seatTex = canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#1d2024'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#0d0e10'; c.lineWidth = 2;
    for (let i = 8; i < w; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); }
  }, 1, 1);
  const wallM = texMat(panel, 0x343b30), floorM = texMat(plate, 0x40454a), seatM = texMat(seatTex, 0x1d2024);

  // ---- casco
  g.add(box(W * 2, 0.1, L * 2, 0, -0.05, 0, 0, floorM));                      // piso
  g.add(box(W * 2, 0.08, L * 2, 0, H + 0.04, 0, 0x23272a));                   // teto (forro)
  for (let z = -L + 0.4; z < L; z += 0.8) g.add(box(W * 2, 0.1, 0.08, 0, H - 0.04, z, 0x15171a));   // cavernas do teto
  g.add(box(0.06, 0.06, L * 2, -0.5, H - 0.1, 0, 0x0d0e10));                  // calha de cabos no teto
  g.add(box(0.06, 0.06, L * 2, 0.6, H - 0.1, 0, 0x0d0e10));
  // parede esquerda: pilares + janelas retangulares abertas (da para ver o mapa de ambos os lados)
  const post = [-L, -1.6, 0, 1.6, L];
  for (const z of post) g.add(box(0.1, H, 0.18, -W, H / 2, z, 0, wallM));
  for (let i = 0; i < post.length - 1; i++) {
    const z0 = post[i], z1 = post[i + 1], zc = (z0 + z1) / 2, ln = z1 - z0 - 0.18;
    g.add(box(0.08, 0.95, ln, -W, 0.475, zc, 0, wallM));                       // parte de baixo
    g.add(box(0.08, 0.5, ln, -W, H - 0.25, zc, 0, wallM));                     // parte de cima
    g.add(box(0.1, 0.05, ln, -W + 0.01, 0.97, zc, 0x111315));                  // moldura da janela
    g.add(box(0.1, 0.05, ln, -W + 0.01, H - 0.52, zc, 0x111315));
  }
  g.add(box(W * 2, H, 0.08, 0, H / 2, L, 0, wallM));                           // parede do fundo
  // faixas de seguranca amarelo/preto na soleira da porta
  for (let z = -L + 0.1; z < L - 0.1; z += 0.3) g.add(box(0.28, 0.02, 0.15, W - 0.14, 0.005, z, (Math.round((z + L) / 0.3) % 2) ? 0xd9b000 : 0x111111));
  // batentes e trilho da porta de correr (a porta fica recolhida na frente)
  g.add(box(0.14, H, 0.14, W, H / 2, -L + 0.07, 0x1a1d20));
  g.add(box(0.14, H, 0.14, W, H / 2, L - 0.07, 0x1a1d20));
  g.add(box(0.16, 0.12, L * 2, W, H - 0.06, 0, 0x1a1d20));                    // trilho de cima
  g.add(box(0.16, 0.1, L * 2, W, 0.05, 0, 0x1a1d20));                         // trilho de baixo
  g.add(box(0.06, 1.8, 1.4, W, 1.0, -L + 0.8, 0x2b3128));                      // porta recolhida (painel)
  g.add(box(0.07, 0.5, 0.9, W + 0.01, 1.5, -L + 0.8, 0x0e1012));              // vidro escuro da porta
  // barras de segurar na porta
  g.add(cyl(0.025, 1.7, W - 0.12, 1.2, 1.75, 0x9aa0a6, 'y'));
  g.add(cyl(0.025, 1.7, W - 0.12, 1.2, -1.45, 0x9aa0a6, 'y'));
  g.add(cyl(0.02, L * 2 - 0.4, W - 0.1, H - 0.35, 0, 0x9aa0a6, 'z'));         // barra de cima
  // luzes de salto: vermelha e verde acima da porta
  g.add(box(0.1, 0.1, 0.1, W - 0.12, H - 0.3, 0.3, 0xff2a1a));
  g.add(box(0.1, 0.1, 0.1, W - 0.12, H - 0.3, 0.65, 0x33ff55));
  // luzes de teto
  for (const z of [-1.6, 0.2, 2.0]) { g.add(box(0.6, 0.04, 0.26, 0, H - 0.02, z, 0xfff0c8)); }

  // ---- banco de tropa na parede esquerda (assento + encosto + cinto + apoio de cabeca)
  for (const z of [-2.2, -1.1, 0.0, 1.1, 2.2]) {
    g.add(box(0.5, 0.1, 0.8, -W + 0.32, 0.52, z, 0, seatM));
    g.add(box(0.1, 0.62, 0.8, -W + 0.1, 0.98, z, 0, seatM));
    g.add(box(0.14, 0.2, 0.34, -W + 0.12, 1.4, z, 0x15171a));
    g.add(box(0.04, 0.05, 0.62, -W + 0.2, 1.05, z, 0x7c7a55));                 // cinto cruzando
    g.add(box(0.05, 0.1, 0.1, -W + 0.21, 0.95, z, 0xc0c4c8));                  // fivela
    g.add(cyl(0.025, 0.5, -W + 0.34, 0.25, z - 0.3, 0x15171a, 'y')); g.add(cyl(0.025, 0.5, -W + 0.34, 0.25, z + 0.3, 0x15171a, 'y'));
  }
  // banco do fundo
  g.add(box(W * 1.7, 0.1, 0.55, 0, 0.52, L - 0.4, 0, seatM));
  g.add(box(W * 1.7, 0.7, 0.1, 0, 0.98, L - 0.14, 0, seatM));
  // rede de carga na parede do fundo (faixas cruzadas)
  for (let i = -3; i <= 3; i++) g.add(box(0.03, 1.0, 0.02, i * 0.2, 1.9, L - 0.05, 0x6e6a4a));
  for (let i = 0; i < 4; i++) g.add(box(1.4, 0.03, 0.02, 0, 1.45 + i * 0.25, L - 0.05, 0x6e6a4a));
  // extintor e kit de primeiros socorros
  g.add(cyl(0.07, 0.38, W - 0.3, 0.3, L - 0.2, 0xc01818, 'y'));
  g.add(box(0.34, 0.24, 0.12, -0.9, 1.55, L - 0.08, 0xdedede)); g.add(box(0.2, 0.06, 0.13, -0.9, 1.55, L - 0.08, 0xc01818));
  // argolas de amarracao no piso
  for (const [x, z] of [[-0.9, -2.6], [0.9, -2.6], [-0.9, 2.6], [0.9, 2.6], [-0.9, 0.2], [0.9, 0.2]]) g.add(cyl(0.05, 0.015, x, 0.01, z, 0x8a9096, 'y', 10));
  // metralhadora de porta (suporte e cano) na frente
  g.add(cyl(0.03, 1.0, W - 0.25, 0.6, -1.3, 0x20252a, 'y'));
  g.add(cyl(0.025, 0.9, W - 0.25, 1.1, -1.3 + 0.2, 0x0f1114, 'z'));
  g.add(box(0.1, 0.14, 0.4, W - 0.25, 1.1, -1.3 - 0.1, 0x16191c));

  // ---- cabine de comando (visivel na frente)
  const zf = -L - 0.05;
  g.add(box(W * 2, 1.1, 0.1, 0, 0.55, zf, 0x23272a));                          // painel inferior
  for (const x of [-0.6, 0.6]) {                                                // bancos dos pilotos
    g.add(box(0.5, 0.1, 0.55, x, 0.5, -L + 0.7, 0x17191c));
    g.add(box(0.5, 0.75, 0.1, x, 0.95, -L + 0.98, 0x17191c));
    g.add(box(0.3, 0.2, 0.1, x, 1.4, -L + 0.98, 0x17191c));
  }
  g.add(box(0.5, 0.45, 0.6, 0, 0.25, -L + 0.65, 0x1b1f22));                    // console central
  g.add(box(0.5, 0.06, 0.3, 0, 0.5, -L + 0.5, 0x0f1316));
  for (let i = 0; i < 6; i++) g.add(box(0.05, 0.03, 0.03, -0.18 + i * 0.07, 0.54, -L + 0.4, [0x33ff55, 0xffb300, 0x33aaff, 0xff2a1a, 0x33ff55, 0xffb300][i]));
  g.add(box(W * 1.8, 0.5, 0.12, 0, 1.2, zf - 0.02, 0x111417));                  // painel de instrumentos
  for (const x of [-0.7, -0.35, 0.35, 0.7]) g.add(box(0.2, 0.2, 0.02, x, 1.2, zf + 0.05, 0x182a3a));
  g.add(box(W * 2, 0.07, 0.1, 0, 1.55, zf - 0.02, 0x15181b));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, 0.9), new THREE.MeshBasicMaterial({ color: 0x6f8aa0, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
  glass.position.set(0, 2.05, zf - 0.04); g.add(glass);                         // para-brisa
  for (const x of [-W, 0, W]) g.add(box(0.09, 0.95, 0.09, x, 2.05, zf - 0.03, 0x15181b));
  mergeStatic(g);
  return g;
}

export function createHeli(scene, renderer, camera) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const model = new THREE.Group(); model.rotation.y = -Math.PI / 2; model.scale.setScalar(8); model.visible = false; root.add(model);
  const cabin = buildCabin(); cabin.visible = false; root.add(cabin);
  let main = null, tail = null, ready = false;
  fetch('heli.glb').then((r) => r.arrayBuffer()).then((buf) => {
    const { root: r, parts } = buildGLB(buf, renderer);
    model.add(r); main = parts.rotor_main; tail = parts.rotor_tail; ready = true;
    prewarm();
  }).catch(() => { /* sem modelo: so a cabine */ });
  // compila os shaders e envia as texturas para a GPU antes do primeiro uso (evita trava na hora de pular)
  function prewarm() {
    if (!renderer || !camera) return;
    const rv = root.visible, mv = model.visible, cv = cabin.visible;
    root.visible = model.visible = cabin.visible = true;
    try {
      cabin.traverse((o) => { if (o.material && o.material.map) renderer.initTexture(o.material.map); });
      renderer.compile(scene, camera);
    } catch (e) { /* ok */ }
    root.visible = rv; model.visible = mv; cabin.visible = cv;
  }
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
