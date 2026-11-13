// Cenario EXTERNO visto pelas janelas do fundo da sala: construcao antiga inacabada em ruinas,
// predio de tijolos desabado, estruturas de ferro e guindastes abandonados, ceu de entardecer.
// Tudo e feito com poucas malhas instanciadas (cada grupo = 1 chamada de desenho) para rodar bem no celular.
// Materiais do exterior ignoram a nevoa da sala (fog:false) e usam "brilho proprio" leve, assim
// nao dependem das luzes internas e o visual da sala nao muda.
import * as THREE from 'three';
import { makeBox, makeCircle, setTerrain } from './logic/collision.js';
import { terrainHeight, buildTerrainGrid, makeTerrainSurface } from './logic/terrain.js';
import { buildRegiao } from './logic/regiao.js';
import { buildCasas } from './logic/casas.js';

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Coletor de barras e caixas que vira UM InstancedMesh. */
class Bag {
  constructor() { this.mats = []; this.xf = null; }
  setTransform(m) { this.xf = m; }
  bar(a, b, t) {
    _a.copy(a); _b.copy(b);
    if (this.xf) { _a.applyMatrix4(this.xf); _b.applyMatrix4(this.xf); }
    _d.subVectors(_b, _a);
    const len = _d.length();
    if (len < 1e-4) return;
    _d.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_up, _d);
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _s.set(t, len, t);
    this.mats.push(new THREE.Matrix4().compose(_p.clone(), _q.clone(), _s.clone()));
  }
  box(cx, cy, cz, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
    _p.set(cx, cy, cz);
    _q.setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    _s.set(sx, sy, sz);
    const m = new THREE.Matrix4().compose(_p.clone(), _q.clone(), _s.clone());
    if (this.xf) m.premultiply(this.xf);
    this.mats.push(m);
  }
  build(material, geometry, parent) {
    if (!this.mats.length) return null;
    const im = new THREE.InstancedMesh(geometry, material, this.mats.length);
    this.mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false; // caixa de visao do conjunto e enorme; custo desprezivel
    im.matrixAutoUpdate = false;
    parent.add(im);
    return im;
  }
}

function brickTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#6f6862';
  g.fillRect(0, 0, 256, 256);
  const r = rng(404);
  const bw = 32;
  const bh = 16;
  for (let y = 0; y < 256; y += bh) {
    const off = ((y / bh) % 2) * (bw / 2);
    for (let x = -bw; x < 256 + bw; x += bw) {
      const v = 0.6 + r() * 0.4;
      g.fillStyle = `rgb(${Math.round(125 * v + 25)},${Math.round(62 * v + 14)},${Math.round(45 * v + 10)})`;
      g.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
    }
  }
  for (let k = 0; k < 260; k++) { // reboco soltando e sujeira
    g.fillStyle = `rgba(${120 + r() * 60},${115 + r() * 50},${105 + r() * 40},${0.12 + r() * 0.25})`;
    g.fillRect(r() * 256, r() * 256, 4 + r() * 16, 3 + r() * 12);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gradientTexture(stops, h = 256) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = h;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  stops.forEach(([p, col]) => grd.addColorStop(p, col));
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,236,190,1)');
  grd.addColorStop(0.12, 'rgba(255,190,110,0.85)');
  grd.addColorStop(0.4, 'rgba(255,120,60,0.28)');
  grd.addColorStop(1, 'rgba(255,90,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildScenery(scene, lib, renderer) {
  const root = new THREE.Group();
  root.name = 'cenario-externo';
  const colliders = [];
  scene.add(root);

  const haze = new THREE.Color(0x8d6f6a);
  const concreteSet = lib.concrete();
  const metalSet = lib.metalPanel();
  const brick = brickTexture();

  // material de exterior: cor base + "brilho proprio" do mesmo mapa, sem nevoa
  const mat = (color, map, hz = 0, emissive = 0.34, rough = 0.95, metal = 0) => {
    const c = new THREE.Color(color).lerp(haze, hz);
    const m = new THREE.MeshStandardMaterial({
      color: c, map: map || null, roughness: rough, metalness: metal, fog: false,
    });
    if (map) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = map; m.emissiveIntensity = emissive * (1 - hz * 0.4); }
    else { m.emissive = c.clone(); m.emissiveIntensity = emissive; }
    return m;
  };

  const unit = new THREE.BoxGeometry(1, 1, 1);
  setTerrain(makeTerrainSurface(-84, 84, -312, -17, 3));                 // o relevo vale para jogador, bots, itens, granadas e tiros
  const regiao = buildRegiao();

  // ---------------------------------------------------------------- ceu
  const skyTex = gradientTexture([
    [0.00, '#1c5fc6'], [0.18, '#3b84dc'], [0.34, '#72b1ee'], [0.45, '#b4dbf8'], [0.50, '#e0f1fc'],
    [0.52, '#a8c2cc'], [0.60, '#8e9c94'], [1.00, '#6c7a6e'],
  ]);
  const skyGeo = new THREE.SphereGeometry(240, 24, 16);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false }));
  sky.renderOrder = -10;
  sky.userData.dynamic = true;
  sky.frustumCulled = false;
  root.add(sky);

  // nuvens brancas macias (sprites filhos do ceu: acompanham a camera, quase sem custo)
  {
    const ct = glowTexture();
    const cm = new THREE.SpriteMaterial({ map: ct, color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, fog: false, toneMapped: false });
    const spots = [[-160, 70, -120, 90], [-40, 95, -200, 110], [120, 80, -150, 100], [190, 60, 20, 80], [-190, 55, 40, 90], [40, 110, 180, 120], [-80, 85, 170, 100], [150, 100, -60, 70]];
    for (const [x, y, z, w] of spots) {
      const c = new THREE.Sprite(cm);
      c.position.set(x, y, z); c.scale.set(w, w * 0.32, 1); c.renderOrder = -9; c.userData.dynamic = true;
      sky.add(c);
    }
  }

  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }));
  sun.position.set(-70, 22, -210);
  sun.material.color.set(0xfff2c8);
  sun.scale.set(150, 150, 1);
  sun.renderOrder = -9;
  sun.userData.dynamic = true;
  root.add(sun);

  // ---------------------------------------------------------------- chao
  const groundTex = concreteSet.map.clone();
  groundTex.repeat.set(1, 1);
  groundTex.needsUpdate = true;
  {
    // chao com relevo: malha de 3 m em volta da area jogavel + planos simples (sem relevo) mais longe
    const g = buildTerrainGrid(-84, 84, -312, -17, 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(g.col, 3));
    geo.setIndex(new THREE.BufferAttribute(g.idx, 1));
    geo.computeBoundingSphere();
    const tm = new THREE.MeshBasicMaterial({ map: groundTex, vertexColors: true, color: 0xb0a090, fog: false });
    const terrain = new THREE.Mesh(geo, tm);
    terrain.name = 'relevo';
    terrain.userData.noMerge = true; terrain.userData.noAuto = true;
    root.add(terrain);
    const farMat = new THREE.MeshBasicMaterial({ map: groundTex, color: 0xb0a090, fog: false });
    const farPlane = (x0, x1, z0, z1) => {
      const pg = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1);
      const uv = pg.attributes.uv;
      pg.rotateX(-Math.PI / 2);
      const pp = pg.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (pp.getX(i) + (x0 + x1) / 2) / 10.5, (pp.getZ(i) + (z0 + z1) / 2) / 10.5);
      const m = new THREE.Mesh(pg, farMat);
      m.position.set((x0 + x1) / 2, -0.01, (z0 + z1) / 2);
      root.add(m);
    };
    farPlane(-420, -84, -420, -17); farPlane(84, 420, -420, -17); farPlane(-84, 84, -420, -312);
  }

  // limites: so se pode ir para fora pelas janelas do fundo; blocos invisiveis fecham as laterais e o perimetro
  colliders.push(makeBox(-70, -17, -8, 45));            // fora da lateral esquerda da sala
  colliders.push(makeBox(8, -17, 70, 45));              // fora da lateral direita da sala
  colliders.push(makeBox(-70, -306, 70, -305, -30, 40));   // fundo da regiao nova (a ravina e as pontes ligam as duas partes)
  colliders.push(makeBox(-71, -306, -70, 45, -30, 40));
  colliders.push(makeBox(70, -306, 71, 45, -30, 40));

  // ---------------------------------------------------------------- materiais
  const mConcrete = mat(0x8a857d, concreteSet.map, 0.12, 0.36);
  const mConcreteFar = mat(0x8a857d, concreteSet.map, 0.45, 0.36);
  const mBrick = mat(0xffffff, brick, 0.2, 0.34);
  const mRust = mat(0x8a4f30, metalSet.map, 0.2, 0.3, 0.85, 0.5);
  const mRustFar = mat(0x8a4f30, metalSet.map, 0.5, 0.3, 0.85, 0.5);
  const mCraneA = mat(0xb08a30, metalSet.map, 0.3, 0.32, 0.8, 0.45); // amarelo desbotado
  const mCraneB = mat(0x8a3a2a, metalSet.map, 0.3, 0.32, 0.8, 0.45); // vermelho oxidado
  const mCraneC = mat(0x5c6672, metalSet.map, 0.4, 0.32, 0.8, 0.45); // cinza azulado
  const mDark = mat(0x2a2624, null, 0.2, 0.35);
  const mDeck = mat(0x59534c, metalSet.map, 0.2, 0.34, 0.8, 0.4);

  // ---------------------------------------------------------------- plataformas, corrimaos e elevadores de obra
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const elevators = [];
  const drums = [];
  let drumMesh = null;
  const railBag = new Bag();
  const mCar = mat(0xc9a227, metalSet.map, 0.1, 0.4, 0.7, 0.5);
  const mCarDark = mat(0x26282b, null, 0.1, 0.3);
  const mLamp = new THREE.MeshBasicMaterial({ color: 0xff8a2a, fog: false, toneMapped: false });
  const carFloorGeo = new THREE.BoxGeometry(2.0, 0.14, 2.0);
  const carPostGeo = new THREE.BoxGeometry(0.08, 1.9, 0.08);
  const carRoofGeo = new THREE.BoxGeometry(2.1, 0.08, 2.1);
  const carLampGeo = new THREE.BoxGeometry(0.22, 0.14, 0.22);

  /** Elevador de obra: cabine aberta que sobe e desce sozinha, parando em cada andar. O jogador sobe nela. */
  function addElevator(x, z, stops, speed = 2.8, dwell = 3.2, braceTo = null) {
    const group = new THREE.Group();
    const fl = new THREE.Mesh(carFloorGeo, mCar); fl.position.y = -0.07; group.add(fl);
    for (const [px, pz] of [[-0.96, -0.96], [0.96, -0.96], [0.96, 0.96], [-0.96, 0.96]]) {
      const pm = new THREE.Mesh(carPostGeo, mCarDark); pm.position.set(px, 0.95, pz); group.add(pm);
    }
    const roof = new THREE.Mesh(carRoofGeo, mCarDark); roof.position.y = 1.94; group.add(roof);
    const lamp = new THREE.Mesh(carLampGeo, mLamp); lamp.position.y = 2.05; group.add(lamp);
    group.position.set(x, stops[0], z);
    root.add(group);
    const col = makeBox(x - 1, z - 1, x + 1, z + 1, stops[0] - 0.3, stops[0]);
    colliders.push(col);
    const top = stops[stops.length - 1];
    for (const [dx, dz] of [[-1.12, -1.12], [1.12, -1.12], [1.12, 1.12], [-1.12, 1.12]]) railBag.bar(V(x + dx, 0, z + dz), V(x + dx, top + 2.6, z + dz), 0.1);
    for (let y = 3; y < top + 2.4; y += 3) {
      railBag.bar(V(x - 1.12, y, z - 1.12), V(x + 1.12, y, z - 1.12), 0.05);
      railBag.bar(V(x - 1.12, y, z + 1.12), V(x + 1.12, y, z + 1.12), 0.05);
      railBag.bar(V(x - 1.12, y, z - 1.12), V(x - 1.12, y, z + 1.12), 0.05);
      railBag.bar(V(x + 1.12, y, z - 1.12), V(x + 1.12, y, z + 1.12), 0.05);
      if (braceTo && (Math.round(y / 3) % 2 === 0)) {
        const dxm = braceTo.x - x;
        const dzm = braceTo.z - z;
        const cs = Math.abs(dxm) > Math.abs(dzm)
          ? [[x + Math.sign(dxm) * 1.12, z - 1.12], [x + Math.sign(dxm) * 1.12, z + 1.12]]
          : [[x - 1.12, z + Math.sign(dzm) * 1.12], [x + 1.12, z + Math.sign(dzm) * 1.12]];
        for (const [cx, cz] of cs) railBag.bar(V(cx, y, cz), V(braceTo.x, y, braceTo.z), 0.06);
      }
    }
    elevators.push({ group, col, stops, idx: 0, dir: 1, y: stops[0], wait: 2, speed, dwell });
  }

  /** Corrimao ao longo de uma poligonal (com colisao). `skip(x,z)` abre passagens. */
  function railPath(pts, y, skip) {
    for (let sg = 0; sg < pts.length - 1; sg++) {
      const [ax, az] = pts[sg];
      const [bx, bz] = pts[sg + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(L / 0.9));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const px = ax + ((bx - ax) * i) / n;
        const pz = az + ((bz - az) * i) / n;
        if (skip && skip(px, pz)) { prev = null; continue; }
        railBag.bar(V(px, y, pz), V(px, y + 1.15, pz), 0.07);
        if (prev) {
          railBag.bar(V(prev[0], y + 1.15, prev[1]), V(px, y + 1.15, pz), 0.06);
          railBag.bar(V(prev[0], y + 0.6, prev[1]), V(px, y + 0.6, pz), 0.04);
        }
        const rc = makeBox(px - 0.4, pz - 0.4, px + 0.4, pz + 0.4, y, y + 1.6);
        rc.noShoot = true;              // gradil: bloqueia o corpo, mas da para atirar por entre as grades
        colliders.push(rc);
        prev = [px, pz];
      }
    }
  }

  // ---------------------------------------------------------------- A) construcao inacabada de concreto
  {
    const r = rng(11);
    const bagCol = new Bag();
    const bagSlab = new Bag();
    const bagRebar = new Bag();
    const bagWall = new Bag();
    const bagScaf = new Bag();
    const cx0 = -15;
    const cz0 = -47;
    const nx = 5;
    const nz = 4;
    const sx = 4.2;
    const sz = 3.8;
    const floorH = 3.3;
    const floors = 4;
    const ox = cx0 - ((nx - 1) * sx) / 2;
    const oz = cz0 - ((nz - 1) * sz) / 2;
    // colunas (alturas variadas: algumas quebradas)
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const full = floorH * floors;
        const h = full - (r() < 0.35 ? floorH * (0.4 + r() * 0.8) : 0) - (i === 0 && k === 0 ? floorH : 0);
        bagCol.box(ox + i * sx, h / 2, oz + k * sz, 0.55, h, 0.55);
        colliders.push(makeBox(ox + i * sx - 0.3, oz + k * sz - 0.3, ox + i * sx + 0.3, oz + k * sz + 0.3, 0, h));
        // ferros de espera no topo
        for (let q = 0; q < 4; q++) {
          const dx = (q % 2 ? 1 : -1) * 0.18;
          const dz = (q < 2 ? 1 : -1) * 0.18;
          const len = 0.9 + r() * 1.2;
          bagRebar.bar(new THREE.Vector3(ox + i * sx + dx, h - 0.1, oz + k * sz + dz),
            new THREE.Vector3(ox + i * sx + dx + (r() - 0.5) * 0.5, h + len, oz + k * sz + dz + (r() - 0.5) * 0.5), 0.035);
        }
      }
    }
    // lajes parciais (alguma celula falta, como desabada)
    for (let f = 1; f <= floors - 1; f++) {
      for (let i = 0; i < nx - 1; i++) {
        for (let k = 0; k < nz - 1; k++) {
          const keep0 = f === 1 ? r() < 0.9 : f === 2 ? r() < 0.7 : r() < 0.38;
          const keep = keep0 || (i === nx - 2 && k === 0);                 // a laje ao lado do elevador sempre existe
          if (!keep) continue;
          const tilt = r() < 0.12 ? (r() - 0.5) * 0.35 : 0; // laje caida
          bagSlab.box(ox + (i + 0.5) * sx, f * floorH, oz + (k + 0.5) * sz, sx - 0.05, 0.28, sz - 0.05, 0, tilt, tilt * 0.6);
          colliders.push(makeBox(ox + i * sx + sx * 0.025 + 0.02, oz + k * sz + sz * 0.025 + 0.02, ox + (i + 1) * sx - sx * 0.025 - 0.02, oz + (k + 1) * sz - sz * 0.025 - 0.02, f * floorH - 0.14, f * floorH + 0.14));
        }
      }
    }
    // vigas soltas no ultimo nivel
    for (let i = 0; i < nx - 1; i++) {
      if (r() < 0.6) {
        bagSlab.box(ox + (i + 0.5) * sx, (floors - 1) * floorH - 0.2, oz, sx, 0.4, 0.35);
        colliders.push(makeBox(ox + i * sx + sx * 0.03, oz - 0.18, ox + (i + 1) * sx - sx * 0.03, oz + 0.18, (floors - 1) * floorH - 0.4, (floors - 1) * floorH));
      }
    }
    // nucleo de escada/elevador
    bagWall.box(ox + sx * 3.5, floorH * 1.6, oz + sz * 1.2, 3.2, floorH * 3.2, 0.3);
    bagWall.box(ox + sx * 3.5 + 1.6, floorH * 1.3, oz + sz * 1.2 + 1.5, 0.3, floorH * 2.6, 3.0);
    colliders.push(makeBox(ox + sx * 3.5 - 1.6, oz + sz * 1.2 - 0.15, ox + sx * 3.5 + 1.6, oz + sz * 1.2 + 0.15, 0, floorH * 3.2));
    colliders.push(makeBox(ox + sx * 3.5 + 1.45, oz + sz * 1.2, ox + sx * 3.5 + 1.75, oz + sz * 1.2 + 3.0, 0, floorH * 2.6));
    // paredes de bloco no terreo, incompletas
    for (let i = 0; i < nx - 1; i++) {
      const h = 0.6 + r() * 2.2;
      if (r() < 0.8) {
        bagWall.box(ox + (i + 0.5) * sx, h / 2, oz + (nz - 1) * sz, sx - 0.7, h, 0.25);
        colliders.push(makeBox(ox + (i + 0.5) * sx - (sx - 0.7) / 2, oz + (nz - 1) * sz - 0.125, ox + (i + 0.5) * sx + (sx - 0.7) / 2, oz + (nz - 1) * sz + 0.125, 0, h));
      }
    }
    for (let k = 0; k < nz - 1; k++) {
      const h = 0.5 + r() * 1.8;
      if (r() < 0.7) {
        bagWall.box(ox, h / 2, oz + (k + 0.5) * sz, 0.25, h, sz - 0.7);
        colliders.push(makeBox(ox - 0.125, oz + (k + 0.5) * sz - (sz - 0.7) / 2, ox + 0.125, oz + (k + 0.5) * sz + (sz - 0.7) / 2, 0, h));
      }
    }
    // andaime de ferro na face da frente
    {
      const zf = oz + (nz - 1) * sz + 1.1;
      const levels = 5;
      const bays = 5;
      for (let b = 0; b <= bays; b++) {
        const x = ox + 0.4 + b * 3.2;
        bagScaf.bar(new THREE.Vector3(x, 0, zf), new THREE.Vector3(x, levels * 2.2, zf), 0.07);
        bagScaf.bar(new THREE.Vector3(x, 0, zf + 1.1), new THREE.Vector3(x, levels * 2.2, zf + 1.1), 0.07);
      }
      for (let l = 1; l <= levels; l++) {
        const y = l * 2.2;
        if (r() < 0.2) continue;
        bagScaf.bar(new THREE.Vector3(ox + 0.4, y, zf), new THREE.Vector3(ox + 0.4 + bays * 3.2, y, zf), 0.06);
        bagScaf.bar(new THREE.Vector3(ox + 0.4, y, zf + 1.1), new THREE.Vector3(ox + 0.4 + bays * 3.2, y, zf + 1.1), 0.06);
        for (let b = 0; b < bays; b++) {
          if (r() < 0.25) continue;
          const x = ox + 0.4 + b * 3.2;
          bagScaf.bar(new THREE.Vector3(x, y - 2.2, zf), new THREE.Vector3(x + 3.2, y, zf), 0.04);
          bagScaf.box(x + 1.6, y, zf + 0.55, 3.0, 0.06, 1.1);
        }
      }
    }
    addElevator(ox + (nx - 1) * sx + 1.0, oz + 0.5 * sz, [0.12, 3.46, 6.76, 10.06], 2.6, 3.4, { x: ox + (nx - 1) * sx, z: oz + 0.5 * sz });
    bagCol.build(mConcrete, unit, root);
    bagSlab.build(mConcrete, unit, root);
    bagWall.build(mConcrete, unit, root);
    bagRebar.build(mRust, unit, root);
    bagScaf.build(mRust, unit, root);
  }

  // ---------------------------------------------------------------- B) predio de tijolos desabado
  {
    const r = rng(23);
    const bag = new Bag();
    const bagFloor = new Bag();
    const rebar = new Bag();
    const cx = 17;
    const cz = -38;
    const W = 13;
    const D = 9;
    const H = 7.2;
    const th = 0.38;
    const wall = (x1, z1, x2, z2, height, windows) => {
      const L = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.max(2, Math.round(L / 1.15));
      const ang = Math.atan2(-(z2 - z1), x2 - x1);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const px = x1 + (x2 - x1) * t;
        const pz = z1 + (z2 - z1) * t;
        const w = L / n;
        const edge = Math.min(t, 1 - t);
        let top = height * (0.28 + 0.72 * Math.pow(r(), 0.55)) * (edge < 0.08 ? 1 : 0.92);
        if (r() < 0.12) top = height; // pano de parede ainda em pe
        const horiz = Math.abs(ang) < 0.1 || Math.abs(Math.abs(ang) - Math.PI) < 0.1;
        const hx = horiz ? w / 2 : th / 2;
        const hz = horiz ? th / 2 : w / 2;
        if (windows && i % 3 === 1 && top > 1.4) {
          bag.box(px, 0.45, pz, w, 0.9, th, ang);                       // peitoril
          colliders.push(makeBox(px - hx, pz - hz, px + hx, pz + hz, 0, 0.9));
          if (top > 2.5) {
            bag.box(px, (2.3 + top) / 2, pz, w, top - 2.3, th, ang);    // verga/parede acima
            colliders.push(makeBox(px - hx, pz - hz, px + hx, pz + hz, 2.3, top));
          }
        } else {
          bag.box(px, top / 2, pz, w, top, th, ang);
          colliders.push(makeBox(px - hx, pz - hz, px + hx, pz + hz, 0, top));
        }
      }
    };
    wall(cx - W / 2, cz - D / 2, cx + W / 2, cz - D / 2, H, true);     // fundo
    wall(cx - W / 2, cz - D / 2, cx - W / 2, cz + D / 2, H * 0.8, true); // lateral esq
    wall(cx + W / 2, cz - D / 2, cx + W / 2, cz + D / 2, H * 0.55, true); // lateral dir (mais caida)
    wall(cx - W / 2, cz + D / 2, cx + W / 2, cz + D / 2, H * 0.45, true); // frente (quase toda caida)
    // piso do primeiro andar, desabado de um lado
    bagFloor.box(cx - 2.8, 3.1, cz - 1, 7.0, 0.25, 6.5, 0, 0.0, -0.12);
    bagFloor.box(cx + 2.4, 1.3, cz + 0.5, 4.2, 0.25, 5.0, 0, 0.18, 0.28);
    // vigas de ferro expostas
    for (let i = 0; i < 6; i++) {
      const x = cx - W / 2 + 1 + i * 2.3;
      rebar.bar(new THREE.Vector3(x, 3.0, cz - D / 2 + 0.2), new THREE.Vector3(x + (r() - 0.5) * 0.6, 3.0, cz + 2 + r() * 2), 0.13);
    }
    bag.build(mBrick, unit, root);
    bagFloor.build(mConcrete, unit, root);
    rebar.build(mRust, unit, root);
  }

  // ---------------------------------------------------------------- entulho e blocos espalhados
  {
    const r = rng(77);
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const count = 90;
    const im = new THREE.InstancedMesh(geo, mConcrete, count);
    for (let i = 0; i < count; i++) {
      const x = (r() - 0.5) * 120;
      const z = -22 - r() * 70;
      const s = 0.25 + Math.pow(r(), 2.2) * 1.5;
      _p.set(x, s * 0.4 - 0.04, z);
      _q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
      _s.set(s * (0.8 + r() * 0.8), s * 0.6, s * (0.8 + r() * 0.8));
      _m.compose(_p, _q, _s);
      im.setMatrixAt(i, _m);
      // colisao da pedra: caixa que acompanha o tamanho real (rotacionado) da pedra; pedrinhas baixas ficam pisaveis
      const e = _m.elements;
      const hx = Math.hypot(e[0], e[4], e[8]) * 0.88, hy = Math.hypot(e[1], e[5], e[9]) * 0.88, hz = Math.hypot(e[2], e[6], e[10]) * 0.88;
      const top = _p.y + hy;
      if (top > 0.3) colliders.push(makeBox(x - hx, z - hz, x + hx, z + hz, 0, top));
    }
    im.frustumCulled = false;
    im.matrixAutoUpdate = false;
    root.add(im);
  }

  // ---------------------------------------------------------------- ferro: guindastes e estruturas
  /** Mastro quadrado treliçado. */
  function mast(bag, x, z, h, w, segs) {
    const sh = h / segs;
    const hw = w / 2;
    const c = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
    for (let s = 0; s < segs; s++) {
      const y0 = s * sh;
      const y1 = y0 + sh;
      for (let i = 0; i < 4; i++) {
        const [ax, az] = c[i];
        const [bx, bz] = c[(i + 1) % 4];
        if (s === 0 || true) bag.bar(V(x + ax, y0, z + az), V(x + ax, y1, z + az), 0.22);
        bag.bar(V(x + ax, y1, z + az), V(x + bx, y1, z + bz), 0.1);
        bag.bar(V(x + ax, y0, z + az), V(x + bx, y1, z + bz), 0.08);
        bag.bar(V(x + bx, y0, z + bz), V(x + ax, y1, z + az), 0.08);
      }
    }
  }

  /** Lanca treliçada triangular ao longo de +X (a partir de (x0,y,z)). */
  function jib(bag, x0, y, z, len, hgt, segs, tipDrop = 0) {
    const sl = len / segs;
    for (let s = 0; s < segs; s++) {
      const xa = x0 + s * sl;
      const xb = xa + sl;
      const hA = hgt * (1 - (s / segs) * 0.75);
      const hB = hgt * (1 - ((s + 1) / segs) * 0.75);
      const dA = -tipDrop * Math.pow(s / segs, 2);
      const dB = -tipDrop * Math.pow((s + 1) / segs, 2);
      // banzo superior e dois inferiores
      bag.bar(V(xa, y + hA + dA, z), V(xb, y + hB + dB, z), 0.16);
      bag.bar(V(xa, y + dA, z - 0.55), V(xb, y + dB, z - 0.55), 0.14);
      bag.bar(V(xa, y + dA, z + 0.55), V(xb, y + dB, z + 0.55), 0.14);
      // montantes e diagonais
      bag.bar(V(xb, y + hB + dB, z), V(xb, y + dB, z - 0.55), 0.07);
      bag.bar(V(xb, y + hB + dB, z), V(xb, y + dB, z + 0.55), 0.07);
      bag.bar(V(xb, y + dB, z - 0.55), V(xb, y + dB, z + 0.55), 0.07);
      bag.bar(V(xa, y + hA + dA, z), V(xb, y + dB, z - 0.55), 0.06);
      bag.bar(V(xa, y + hA + dA, z), V(xb, y + dB, z + 0.55), 0.06);
    }
  }

  function crane({ x, z, h, jibLen, counterLen, rot, mat: cm, droop = 0, mastSegs, seed, hookDown = 0.5 }) {
    const r = rng(seed);
    // cabine do operador do lado oposto ao elevador (nao bloqueia a entrada)
    const cs0 = Math.cos(rot);
    const sn0 = Math.sin(rot);
    let ux0 = 0;
    let uz0 = 0;
    if (Math.abs(sn0) > Math.abs(cs0)) ux0 = sn0 > 0 ? 1 : -1; else uz0 = cs0 > 0 ? 1 : -1;
    const dotc = (lz) => (cs0 * 0.8 + sn0 * lz) * ux0 + (-sn0 * 0.8 + cs0 * lz) * uz0;
    const cabZ = dotc(1.9) <= dotc(-1.9) ? 1.9 : -1.9;
    const bag = new Bag();
    const boxes = new Bag();
    const mw = 2.3;
    const m = new THREE.Matrix4().makeRotationY(rot);
    m.setPosition(x, 0, z);
    bag.setTransform(m);
    boxes.setTransform(m);
    mast(bag, 0, 0, h, mw, mastSegs);
    colliders.push(makeCircle(x, z, 1.7, 0, h));
    colliders.push(makeBox(x - 2.6, z - 2.6, x + 2.6, z + 2.6, 0, 1.2));
    // base de concreto
    boxes.box(0, 0.6, 0, 5.2, 1.2, 5.2);
    // cabine e torre de cabeca
    boxes.box(0.8, h + 1.2, cabZ, 2.2, 2.0, 2.0);
    bag.bar(V(0, h, 0), V(0, h + 6.5, 0), 0.3);
    // lanca e contra-lanca
    jib(bag, 0.5, h + 0.3, 0, jibLen, 1.9, Math.round(jibLen / 2.4), droop);
    // contra-lanca (aponta para -X)
    for (let s = 0; s < Math.round(counterLen / 2.4); s++) {
      const xa = -0.5 - s * 2.4;
      const xb = xa - 2.4;
      bag.bar(V(xa, h + 0.3, -0.5), V(xb, h + 0.3, -0.5), 0.14);
      bag.bar(V(xa, h + 0.3, 0.5), V(xb, h + 0.3, 0.5), 0.14);
      bag.bar(V(xa, h + 0.3, -0.5), V(xb, h + 0.3, 0.5), 0.07);
    }
    boxes.box(-counterLen + 0.4, h - 0.2, 0, 2.2, 1.8, 2.4); // contrapeso
    boxes.box(-counterLen + 0.4, h + 1.4, 0, 2.2, 1.4, 2.4);
    // tirantes (pendentes) do topo da torre para a lanca e contra-lanca
    bag.bar(V(0, h + 6.5, 0), V(jibLen * 0.45, h + 1.9 + droop * -0.12, 0), 0.06);
    bag.bar(V(0, h + 6.5, 0), V(jibLen * 0.92, h + 0.5 + droop * -0.85, 0), 0.06);
    bag.bar(V(0, h + 6.5, 0), V(-counterLen + 1, h + 0.8, 0), 0.06);
    // cabo e gancho (o cabo pende, alguns rompidos)
    const hx = jibLen * 0.72;
    const hy = h + 0.3 + droop * -0.52;
    const drop = h * hookDown;
    bag.bar(V(hx, hy, 0), V(hx + (r() - 0.5) * 1.5, hy - drop, 0), 0.04);
    boxes.box(hx + (r() - 0.5) * 0.5, hy - drop - 0.5, 0, 0.7, 0.9, 0.7);
    // ---- plataforma de trabalho no topo, passarela pela lanca e elevador de obra (tudo andavel)
    {
      const yD = h + 0.5;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      const W = (lx, lz) => [x + cs * lx + sn * lz, z - sn * lx + cs * lz];
      let ux = 0;
      let uz = 0;
      if (Math.abs(sn) > Math.abs(cs)) ux = sn > 0 ? 1 : -1; else uz = cs > 0 ? 1 : -1; // eixo do elevador: perpendicular a lanca
      const vx = -uz;
      const vz = ux;
      const U = (u, v) => [x + ux * u + vx * v, z + uz * u + vz * v];
      const rect = (u0, u1, v0, v1) => {
        const [xa, za] = U(u0, v0);
        const [xb, zb] = U(u1, v1);
        return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
      };
      const deckBag = new Bag();
      for (const [x1, z1, x2, z2] of [rect(-4, 3.5, -4, 4), rect(3.5, 6.3, 1.1, 4), rect(3.5, 6.3, -4, -1.1)]) {
        colliders.push(makeBox(x1, z1, x2, z2, yD - 0.2, yD));
        deckBag.box((x1 + x2) / 2, yD - 0.1, (z1 + z2) / 2, x2 - x1, 0.2, z2 - z1);
      }
      deckBag.build(mDeck, unit, root);
      // corrimao: perimetro da plataforma, deixando a lanca e a entrada do elevador livres
      const nearJib = (px, pz) => Math.abs((px - x) * sn + (pz - z) * cs) < 1.3;
      const ring = [U(-4, -4), U(6.3, -4), U(6.3, 4), U(-4, 4), U(-4, -4)];
      railPath(ring, yD, (px, pz) => nearJib(px, pz) || (Math.abs((px - x) * ux + (pz - z) * uz - 6.3) < 0.2 && Math.abs((px - x) * vx + (pz - z) * vz) < 1.2 && false));
      railPath([U(3.6, -1.1), U(6.3, -1.1)], yD);
      railPath([U(3.6, 1.1), U(6.3, 1.1)], yD);
      railPath([U(6.3, -1.1), U(6.3, 1.1)], yD);
      // passarela pela lanca e pela contra-lanca
      const strip = (l0, l1) => {
        for (let l = l0; l <= l1 + 1e-6; l += 1.0) {
          const [wx, wz] = W(l, 0);
          colliders.push(makeBox(wx - 0.62, wz - 0.62, wx + 0.62, wz + 0.62, yD - 0.2, yD));
        }
        bag.box((l0 + l1) / 2, yD - 0.1, 0, l1 - l0, 0.2, 1.1);
        for (let l = Math.ceil(l0 / 3) * 3; l <= l1; l += 3) bag.bar(V(l, yD - 0.2, -0.5), V(l, h + 0.3 + 0.2, -0.55), 0.06);
      };
      strip(3.0, jibLen * 0.55);
      strip(-(counterLen - 1.8), -3.0);
      // cabine do operador solida
      const [cx2, cz2] = W(0.8, cabZ);
      colliders.push(makeBox(cx2 - 1.1, cz2 - 1.1, cx2 + 1.1, cz2 + 1.1, yD, h + 2.2));
      const [ex, ez] = U(4.6, 0);
      addElevator(ex, ez, [0.12, yD + 0.02], 3.4, 4.0, { x, z });
    }
    bag.build(cm, unit, root);
    boxes.build(mConcreteFar, unit, root);
  }

  crane({ x: -30, z: -66, h: 36, jibLen: 34, counterLen: 11, rot: 0.15, mat: mCraneA, droop: 3.5, mastSegs: 18, seed: 5 });
  crane({ x: 27, z: -72, h: 31, jibLen: 30, counterLen: 10, rot: Math.PI - 0.25, mat: mCraneB, droop: 0, mastSegs: 16, seed: 6, hookDown: 0.75 });
  crane({ x: 3, z: -98, h: 26, jibLen: 24, counterLen: 8, rot: Math.PI * 0.62, mat: mCraneC, droop: 7, mastSegs: 13, seed: 7, hookDown: 0.35 });

  // estruturas de ferro: porticos, tanques, tubulacoes
  {
    const r = rng(91);
    const bag = new Bag();
    // portico de aco
    const portal = (x, z, w, h) => {
      bag.bar(V(x - w / 2, 0, z), V(x - w / 2, h, z), 0.35);
      bag.bar(V(x + w / 2, 0, z), V(x + w / 2, h, z), 0.35);
      colliders.push(makeBox(x - w / 2 - 0.25, z - 0.25, x - w / 2 + 0.25, z + 0.25, 0, h));
      colliders.push(makeBox(x + w / 2 - 0.25, z - 0.25, x + w / 2 + 0.25, z + 0.25, 0, h));
      bag.bar(V(x - w / 2, h, z), V(x + w / 2, h, z), 0.4);
      bag.bar(V(x - w / 2, h * 0.55, z), V(x, h, z), 0.12);
      bag.bar(V(x + w / 2, h * 0.55, z), V(x, h, z), 0.12);
      for (let i = 1; i < 4; i++) bag.bar(V(x - w / 2 + (w * i) / 4, h, z), V(x - w / 2 + (w * i) / 4, h + 0.9, z), 0.08);
    };
    portal(-3, -58, 11, 9);
    portal(-3, -63, 11, 9.5);
    portal(8, -56, 9, 7.5);
    // plataforma de ferro sobre os dois primeiros porticos + elevador de obra
    {
      const yD = 9.95;
      colliders.push(makeBox(-8.9, -63.6, 2.9, -57.4, yD - 0.2, yD));
      bag.box(-3, yD - 0.1, -60.5, 11.8, 0.2, 6.2);
      railPath([[-8.9, -63.6], [2.9, -63.6], [2.9, -57.4], [-8.9, -57.4]], yD);
      railPath([[-8.9, -63.6], [-8.9, -61.6]], yD);
      railPath([[-8.9, -59.4], [-8.9, -57.4]], yD);
      addElevator(-10.0, -60.5, [0.12, yD + 0.02], 3.0, 4.0, { x: -8.9, z: -60.5 });
    }
    // vigas empilhadas no chao
    for (let i = 0; i < 9; i++) bag.box(-38 + (r() - 0.5) * 3, 0.2 + Math.floor(i / 3) * 0.4, -52 + (i % 3) * 0.55, 8, 0.3, 0.3, 0.05 * i);
    bag.box(40, 0.3, -56, 7, 0.25, 0.4, 0.4);
    bag.box(41, 0.55, -56.5, 6, 0.25, 0.4, 0.35);
    // tubulacao elevada
    for (let i = 0; i < 8; i++) {
      const x = 32 + i * 3.4;
      bag.bar(V(x, 0, -48), V(x, 4.2, -48), 0.25);
      bag.bar(V(x, 0, -50), V(x, 4.2, -50), 0.25);
      bag.bar(V(x, 4.2, -48), V(x, 4.2, -50), 0.2);
    }
    bag.bar(V(32, 4.5, -49), V(32 + 7 * 3.4, 4.5, -49), 0.55);
    bag.bar(V(32, 4.0, -49), V(32 + 7 * 3.4, 4.0, -49), 0.35);
    bag.build(mRustFar, unit, root);

    // tanques oxidados
    const tankGeo = new THREE.CylinderGeometry(3.2, 3.2, 8, 20);
    const bandGeo = new THREE.CylinderGeometry(3.28, 3.28, 0.25, 20);
    for (const [tx, tz, th] of [[-45, -60, 1], [-38.5, -62, 0.7]]) {
      const t = new THREE.Mesh(tankGeo, mRustFar);
      t.position.set(tx, 4 * th, tz);
      t.scale.set(1, th, 1);
      root.add(t);
      colliders.push(makeCircle(tx, tz, 3.2, 0, 8 * th));
      for (const by of [0.2, 0.5, 0.8]) {
        const b = new THREE.Mesh(bandGeo, mDark);
        b.position.set(tx, 8 * th * by, tz);
        root.add(b);
      }
    }
  }

  // ---------------------------------------------------------------- D) barricadas de areia, casas em obra e esconderijos
  {
    const r = rng(2026);
    const reserved = [];
    const R = (x1, z1, x2, z2) => reserved.push([Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2)]);
    const free = (x1, z1, x2, z2, m = 1.2) => {
      for (const q of reserved) if (x2 + m > q[0] && x1 - m < q[2] && z2 + m > q[1] && z1 - m < q[3]) return false;
      return true;
    };
    // areas ja ocupadas pelo cenario anterior
    R(-25, -54, -3, -38); R(9, -44, 25, -32); R(-13, -66, 5, -54); R(1, -60, 15, -52); R(-42, -72, -18, -60);
    R(18, -82, 38, -62); R(-8, -108, 14, -88); R(-52, -68, -33, -54); R(-46, -55, -31, -48); R(30, -53, 58, -45); R(-9, -25, 9, -16);
    for (const [px, pz] of [[0, -24], [-24, -36], [26, -35], [-10, -36], [36, -45], [-50, -34]]) R(px - 1.5, pz - 1.5, px + 1.5, pz + 1.5);

    // sacos de areia (esferas achatadas instanciadas) e demais pecas
    const sandCv = document.createElement('canvas');
    sandCv.width = sandCv.height = 128;
    const sg = sandCv.getContext('2d');
    sg.fillStyle = '#a89468';
    sg.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 500; k++) {
      sg.fillStyle = `rgba(${90 + r() * 60},${75 + r() * 50},${45 + r() * 30},${0.15 + r() * 0.25})`;
      sg.fillRect(r() * 128, r() * 128, 1 + r() * 3, 1 + r() * 8);
    }
    const sandTex = new THREE.CanvasTexture(sandCv);
    sandTex.colorSpace = THREE.SRGBColorSpace;
    const mSand = mat(0xffffff, sandTex, 0.12, 0.4);
    const mCont = [mat(0x8a3328, metalSet.map, 0.15, 0.34, 0.7, 0.4), mat(0x2f5f86, metalSet.map, 0.15, 0.34, 0.7, 0.4), mat(0x4f6b3f, metalSet.map, 0.15, 0.34, 0.7, 0.4), mat(0x7a7468, metalSet.map, 0.15, 0.34, 0.7, 0.4)];
    const sphGeo = new THREE.SphereGeometry(0.5, 7, 5);
    const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
    const bagSand = new Bag();
    const bagBlk = new Bag();
    const bagBrk = new Bag();
    const bagSlabH = new Bag();
    const bagRb = new Bag();
    const bagJersey = new Bag();
    const bagPipe = new Bag();
    const bagDrum = new Bag();
    const bagCont = mCont.map(() => new Bag());

    function sandWall(x1, z1, x2, z2, rows) {
      const alongX = Math.abs(z2 - z1) < 1e-6;
      const a0 = alongX ? Math.min(x1, x2) : Math.min(z1, z2);
      const L = alongX ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
      const fixed = alongX ? z1 : x1;
      const n = Math.max(1, Math.round(L / 0.62));
      const bw = L / n;
      for (let row = 0; row < rows; row++) {
        const odd = row % 2;
        for (let i = 0; i < n - odd; i++) {
          const t = a0 + (i + 0.5 + odd * 0.5) * bw;
          const jx = (r() - 0.5) * 0.04;
          const yy = 0.12 + row * 0.2;
          if (alongX) bagSand.box(t, yy, fixed + jx, bw * 1.08, 0.27, 0.52, (r() - 0.5) * 0.12);
          else bagSand.box(fixed + jx, yy, t, 0.52, 0.27, bw * 1.08, (r() - 0.5) * 0.12);
        }
      }
      const hgt = rows * 0.2 + 0.05;
      if (alongX) colliders.push(makeBox(a0 - 0.05, fixed - 0.27, a0 + L + 0.05, fixed + 0.27, 0, hgt));
      else colliders.push(makeBox(fixed - 0.27, a0 - 0.05, fixed + 0.27, a0 + L + 0.05, 0, hgt));
      if (alongX) R(a0 - 0.8, fixed - 0.8, a0 + L + 0.8, fixed + 0.8); else R(fixed - 0.8, a0 - 0.8, fixed + 0.8, a0 + L + 0.8);
    }

    // linhas de barricadas: perto das janelas, em "L" e em "U" (bastante lugar para se esconder)
    const SW = [
      [-11, -21, -7.6, -21, 5], [-4.4, -21, -1.6, -21, 5], [1.6, -21, 4.4, -21, 5], [7.6, -21, 11, -21, 5],
      [-15, -27, -8, -27, 6], [-4, -27, 4, -27, 7], [8, -27, 15, -27, 6],
      [-20, -23, -20, -30, 6], [-20, -30, -16, -30, 6], [20, -23, 20, -30, 6], [20, -30, 16, -30, 6],
      [26, -38, 34, -38, 6], [26, -38, 26, -42, 6], [34, -38, 34, -42, 6],
      [-36, -40, -28, -40, 6], [-36, -40, -36, -44, 6], [-28, -40, -28, -44, 6],
      [40, -24, 48, -24, 5], [-50, -24, -44, -24, 5], [6, -48, 12, -48, 6],
    ];
    for (const w of SW) sandWall(...w);

    // ---- casas em construcao: paredes de bloco/tijolo em alturas diferentes, vaos de porta e janela
    const T = 0.22;
    const blk = (x1, z1, x2, z2, y0, y1, brick) => {
      if (y1 - y0 < 0.05) return;
      (brick ? bagBrk : bagBlk).box((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2, x2 - x1, y1 - y0, z2 - z1);
      colliders.push(makeBox(x1, z1, x2, z2, y0, y1));
    };
    function wallLine(ax, az, bx, bz, h, doorIdx, winIdxs, brick) {
      const alongX = Math.abs(bz - az) < 1e-6;
      const a0 = alongX ? Math.min(ax, bx) : Math.min(az, bz);
      const L = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
      const n = Math.max(2, Math.round(L / 1.25));
      const sl = L / n;
      for (let i = 0; i < n; i++) {
        const lo = a0 + i * sl;
        const hi = lo + sl;
        const ht = Math.round((r() < 0.22 ? h : h * (0.4 + 0.6 * r())) * 5) / 5;
        const seg = (y0, y1) => (alongX ? blk(lo, az - T / 2, hi, az + T / 2, y0, y1, brick) : blk(ax - T / 2, lo, ax + T / 2, hi, y0, y1, brick));
        if (i === doorIdx) { if (h > 2.4) seg(2.15, Math.max(ht, 2.5)); continue; }
        if (winIdxs.includes(i)) { seg(0, Math.min(0.95, ht)); if (ht > 2.5) seg(2.1, ht); continue; }
        seg(0, ht);
      }
    }
    function house(cx, cz, w, d, h, brick, doorWall) {
      const x1 = cx - w / 2;
      const x2 = cx + w / 2;
      const z1 = cz - d / 2;
      const z2 = cz + d / 2;
      bagSlabH.box(cx, 0.06, cz, w + 0.5, 0.12, d + 0.5);
      colliders.push(makeBox(x1 - 0.25, z1 - 0.25, x2 + 0.25, z2 + 0.25, 0, 0.12));
      const nW = Math.max(2, Math.round(w / 1.25));
      const nD = Math.max(2, Math.round(d / 1.25));
      wallLine(x1, z2, x2, z2, h, doorWall === 'S' ? Math.floor(nW / 2) : -1, [1, nW - 2], brick);   // frente (para a sala)
      wallLine(x1, z1, x2, z1, h, doorWall === 'N' ? Math.floor(nW / 2) : -1, [1, nW - 2], brick);   // fundos
      wallLine(x1, z1, x1, z2, h, doorWall === 'W' ? Math.floor(nD / 2) : -1, [1], brick);           // lateral esquerda
      wallLine(x2, z1, x2, z2, h, doorWall === 'E' ? Math.floor(nD / 2) : -1, [1], brick);           // lateral direita
      for (const [px, pz] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {                              // pilares de concreto com ferros de espera
        blk(px - 0.15, pz - 0.15, px + 0.15, pz + 0.15, 0, h + 0.5, false);
        for (let q = 0; q < 3; q++) bagRb.bar(V(px + (q - 1) * 0.07, h + 0.4, pz), V(px + (q - 1) * 0.1 + (r() - 0.5) * 0.2, h + 1.5 + r() * 0.5, pz + (r() - 0.5) * 0.2), 0.03);
      }
      // dentro: pilha de areia e palete de tijolos, afastados do vao da porta (nao bloqueiam a entrada)
      let dcx = cx;
      let dcz = cz;
      if (doorWall === 'S' || doorWall === 'N') dcx = x1 + (Math.floor(nW / 2) + 0.5) * (w / nW);
      else dcz = z1 + (Math.floor(nD / 2) + 0.5) * (d / nD);
      const offx = dcx > cx + 0.01 ? -1 : 1;
      const offz = dcz > cz + 0.01 ? -1 : 1;
      let px1; let pz1; let ix; let iz;
      if (doorWall === 'S' || doorWall === 'N') {
        const far = doorWall === 'S' ? -1 : 1;
        px1 = cx + offx * w * 0.3; pz1 = cz + far * d * 0.28;
        ix = cx + offx * w * 0.28; iz = cz - far * d * 0.26;
      } else {
        const far = doorWall === 'W' ? 1 : -1;
        px1 = cx + far * w * 0.3; pz1 = cz + offz * d * 0.28;
        ix = cx - far * w * 0.25; iz = cz + offz * d * 0.3;
      }
      bagBrk.box(px1, 0.5, pz1, 1.2, 0.9, 1.0);
      colliders.push(makeBox(px1 - 0.6, pz1 - 0.5, px1 + 0.6, pz1 + 0.5, 0, 0.95));
      bagSand.box(ix, 0.35, iz, 1.8, 0.95, 1.5);
      colliders.push(makeBox(ix - 0.8, iz - 0.65, ix + 0.8, iz + 0.65, 0, 0.7));
      R(x1 - 1, z1 - 1, x2 + 1, z2 + 1);
    }
    house(-38, -26, 8, 6, 2.8, false, 'S');
    house(-29, -34, 6, 5, 2.6, true, 'E');
    house(30, -27, 8, 6, 2.8, true, 'S');
    house(42, -36, 6, 6, 2.6, false, 'W');
    house(-48, -40, 6, 5, 2.8, true, 'E');
    house(2, -36, 7, 5, 2.6, false, 'S');
    house(52, -28, 6, 5, 2.8, true, 'W');
    house(-58, -30, 6, 5, 2.6, false, 'S');
    // trechos de parede soltos, em varias alturas (esconderijo)
    for (let k = 0, placed = 0; k < 80 && placed < 9; k++) {
      const horiz = r() < 0.5;
      const len = 4 + Math.floor(r() * 4) * 1.25;
      const px = (r() - 0.5) * 110;
      const pz = -22 - r() * 48;
      const bx1 = horiz ? px : px - 0.3;
      const bx2 = horiz ? px + len : px + 0.3;
      const bz1 = horiz ? pz - 0.3 : pz;
      const bz2 = horiz ? pz + 0.3 : pz + len;
      if (!free(bx1, bz1, bx2, bz2, 1.5)) continue;
      if (horiz) wallLine(px, pz, px + len, pz, 2.6, -1, [], r() < 0.5); else wallLine(px, pz, px, pz + len, 2.6, -1, [], r() < 0.5);
      R(bx1, bz1, bx2, bz2);
      placed++;
    }
    // containers de carga (cobertura alta)
    for (const [cx, cz, alongX, ci] of [[-12, -31.5, true, 0], [16, -48, true, 1], [-28, -56.5, true, 2], [44, -58, false, 3], [-56, -48, false, 1], [-28, -21, true, 2], [36, -21, true, 0]]) {
      const w = alongX ? 6 : 2.4;
      const d = alongX ? 2.4 : 6;
      bagCont[ci].box(cx, 1.3, cz, w, 2.6, d);
      colliders.push(makeBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, 0, 2.6));
      R(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2);
    }
    // barreiras de concreto, canos, tambores, paletes e pilhas de areia espalhados
    for (let k = 0, placed = 0; k < 400 && placed < 70; k++) {
      const px = (r() - 0.5) * 120;
      const pz = -20 - r() * 55;
      const type = r();
      let w = 2.2;
      let d = 0.6;
      if (type > 0.45 && type < 0.62) { w = 2.6; d = 1.2; }
      else if (type >= 0.62 && type < 0.78) { w = 0.7; d = 0.7; }
      else if (type >= 0.78 && type < 0.9) { w = 1.3; d = 1.1; }
      else if (type >= 0.9) { w = 2.6; d = 2.2; }
      if (!(type <= 0.45 || (type >= 0.62 && type < 0.78)) || true) { /* tamanhos acima */ }
      const along = r() < 0.5;
      const ww = type <= 0.45 ? (along ? 2.2 : 0.6) : w;
      const dd = type <= 0.45 ? (along ? 0.6 : 2.2) : d;
      if (!free(px - ww / 2, pz - dd / 2, px + ww / 2, pz + dd / 2, 1.3)) continue;
      if (type <= 0.45) {                       // barreira de concreto tipo "New Jersey"
        bagJersey.box(px, 0.42, pz, ww, 0.84, dd);
        colliders.push(makeBox(px - ww / 2, pz - dd / 2, px + ww / 2, pz + dd / 2, 0, 0.85));
      } else if (type < 0.62) {                 // cano de concreto deitado
        bagPipe.box(px, 0.6, pz, 1.2, 2.6, 1.2, 0, 0, Math.PI / 2);
        colliders.push(makeBox(px - 1.3, pz - 0.6, px + 1.3, pz + 0.6, 0, 1.2));
      } else if (type < 0.78) {                 // tambor
        bagDrum.box(px, 0.45, pz, 0.62, 0.9, 0.62);
        const dcol = makeCircle(px, pz, 0.32, 0, 0.9);
        colliders.push(dcol);
        drums.push({ x: px, z: pz, r: 0.32, h: 0.9, idx: bagDrum.mats.length - 1, col: dcol });
      } else if (type < 0.9) {                  // palete de tijolos
        bagBrk.box(px, 0.5, pz, 1.3, 0.95, 1.1);
        colliders.push(makeBox(px - 0.65, pz - 0.55, px + 0.65, pz + 0.55, 0, 1.0));
      } else {                                  // pilha de areia
        bagSand.box(px, 0.5, pz, 2.6, 1.3, 2.2);
        colliders.push(makeBox(px - 1.0, pz - 0.85, px + 1.0, pz + 0.85, 0, 0.9));
      }
      R(px - ww / 2, pz - dd / 2, px + ww / 2, pz + dd / 2);
      placed++;
    }
    bagSand.build(mSand, sphGeo, root);
    bagBlk.build(mConcrete, unit, root);
    bagBrk.build(mBrick, unit, root);
    bagSlabH.build(mConcreteFar, unit, root);
    bagRb.build(mRust, unit, root);
    bagJersey.build(mConcrete, unit, root);
    bagPipe.build(mConcreteFar, cylGeo, root);
    for (const d of regiao.drums) {              // barris da regiao nova (caminho, patios, galpoes e hangar)
      bagDrum.box(d.x, 0.45, d.z, 0.62, 0.9, 0.62);
      colliders.push(d.col);
      drums.push({ x: d.x, z: d.z, r: d.r, h: d.h, idx: bagDrum.mats.length - 1, col: d.col });
    }
    drumMesh = bagDrum.build(mRustFar, cylGeo, root);
    bagCont.forEach((b, i) => b.build(mCont[i], unit, root));
  }

  // ---------------------------------------------------------------- E) casas e sobrados abandonados (atras dos guindastes)
  const casas = buildCasas();
  const casaGroups = [];   // uma peca de desenho por casa e por material: a camera so desenha as casas que ve e que estao perto
  {
    const matOf = { wall: mat(0x8f8a80, concreteSet.map, 0.14, 0.36), brick: mBrick, slab: mConcrete, step: mDeck, junk: mRust };
    casas.houses.forEach((h, hi) => {
      const bags = {};
      for (const b of casas.boxes) { if (b.h !== hi) continue; (bags[b.mat] || (bags[b.mat] = new Bag())).box(b.cx, b.cy, b.cz, b.sx, b.sy, b.sz); }
      const grp = new THREE.Group();
      grp.matrixAutoUpdate = false;
      for (const k of Object.keys(bags)) { const im = bags[k].build(matOf[k], unit, grp); if (im) im.frustumCulled = true; }
      root.add(grp);
      casaGroups.push({ grp, x: h.cx, z: h.cz });
    });
    for (const c of casas.colliders) colliders.push(c);
  }

  // ---------------------------------------------------------------- F) regiao nova: ruas, pontes, pista, hangar e galpoes
  {
    const matOf = {
      asphalt: mat(0x3b3c3f, null, 0.1, 0.32), mark: mat(0xe6dfc2, null, 0, 0.55), metal: mat(0x7a858f, metalSet.map, 0.15, 0.34, 0.8, 0.4),
      roof: mat(0x565c62, metalSet.map, 0.2, 0.3, 0.8, 0.4), rail: mRust, junk: mRust, wall: mConcrete,
    };
    const bags = {};
    for (const b of regiao.boxes) (bags[b.mat] || (bags[b.mat] = new Bag())).box(b.cx, b.cy, b.cz, b.sx, b.sy, b.sz);
    for (const k of Object.keys(bags)) { const im = bags[k].build(matOf[k], unit, root); if (im) im.frustumCulled = true; }
    for (const c of regiao.colliders) colliders.push(c);
  }

  // ---------------------------------------------------------------- silhuetas distantes
  {
    const r = rng(131);
    const bag = new Bag();
    for (let i = 0; i < 26; i++) {
      const x = -140 + i * 11 + (r() - 0.5) * 6;
      const h = 8 + Math.pow(r(), 1.6) * 38;
      const w = 6 + r() * 9;
      bag.box(x, h / 2, -325 - r() * 15, w, h, 7 + r() * 5);
    }
    // chaminés
    bag.box(-60, 22, -318, 2.2, 44, 2.2);
    bag.box(70, 18, -322, 2, 36, 2);
    bag.build(mat(0x3a3440, null, 0.55, 0.3), unit, root);
  }

  railBag.build(mRust, unit, root);

  // o ceu acompanha a camera (sem paralaxe); os elevadores de obra sobem e descem sozinhos
  function update(camera, dt = 0) {
    sky.position.copy(camera.position);
    for (const c of casaGroups) { const dx = c.x - camera.position.x, dz = c.z - camera.position.z; const v = dx * dx + dz * dz < 110 * 110; if (c.grp.visible !== v) c.grp.visible = v; }
    sun.position.set(camera.position.x - 70, 22, camera.position.z - 210);
    if (dt <= 0) return;
    for (const e of elevators) {
      if (e.wait > 0) { e.wait -= dt; continue; }
      const tgt = e.stops[e.idx + e.dir];
      const diff = tgt - e.y;
      const step = e.speed * dt;
      if (Math.abs(diff) <= step) {
        e.y = tgt;
        e.idx += e.dir;
        if (e.idx >= e.stops.length - 1) e.dir = -1; else if (e.idx <= 0) e.dir = 1;
        e.wait = e.dwell;
      } else {
        e.y += Math.sign(diff) * step;
      }
      e.group.position.y = e.y;
      e.col.minY = e.y - 0.3;
      e.col.maxY = e.y;
    }
  }

  return { root, update, colliders, elevators, drums, getDrumMesh: () => drumMesh, casaLoot: casas.loot, regiaoLoot: regiao.loot };
}
