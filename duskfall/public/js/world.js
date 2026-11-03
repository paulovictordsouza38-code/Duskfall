// Cenario: sala de treinamento militar fechada (piso de concreto, paredes, estrutura industrial,
// barreiras, caixas, alvos e iluminacao artificial).
import * as THREE from 'three';
import { makeBox, makeCircle, moveCircle } from './logic/collision.js';
import { roundedBox, texturedBox, cylinderAlong, tiledPlane } from './geometry.js';
import { pbr } from './textures.js';
import { Target, makeTargetMaterials } from './targets.js';

// Escala real: 1 unidade = 1 metro. Jogador comeca no fundo (z positivo) olhando para -Z.
export const ROOM = { minX: -8, maxX: 8, minZ: -17, maxZ: 14, h: 5.2 };
export const FIRING_LINE_Z = 5.5;
export const SPAWN = { x: 0, z: 11.6, yaw: 0 };

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();

/** Mapa de ambiente procedural (sala clara com paineis luminosos) para reflexos em metais. */
export function buildEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(20, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0x4a4e54, side: THREE.BackSide }),
  );
  envScene.add(shell);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  panelMat.color.setScalar(9);
  for (const z of [-11, -3, 5, 12]) {
    for (const x of [-2.5, 2.5]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.5), panelMat);
      panel.position.set(x, 3.8, z);
      envScene.add(panel);
    }
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  envScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  return rt.texture;
}

function markingTexture(wM, hM, ppm, draw, aniso) {
  const c = document.createElement('canvas');
  c.width = Math.round(wM * ppm);
  c.height = Math.round(hM * ppm);
  const ctx = c.getContext('2d');
  draw(ctx, c.width, c.height, ppm);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function aabbOfRotated(w, d, yaw) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return { w: w * c + d * s, d: w * s + d * c };
}

export function buildWorld(scene, lib, renderer) {
  const root = new THREE.Group();
  root.name = 'sala-de-treinamento';
  scene.add(root);

  const colliders = [];
  const occluders = [];
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // ---------------- materiais ----------------
  const M = {
    concrete: pbr(lib.concrete(), { normalScale: 0.9 }),
    concreteDark: pbr(lib.concrete(), { color: 0x8e8e8e, normalScale: 1.0 }),
    metalWall: pbr(lib.metalPanel(), { metalness: 0.7, normalScale: 1.0 }),
    metalDark: pbr(lib.metalPanel(), { color: 0x777777, metalness: 0.85, normalScale: 1.0 }),
    crate: pbr(lib.crate(), { metalness: 0.2, normalScale: 0.8 }),
    rubber: pbr(lib.rubber(), { normalScale: 1.0 }),
    backstop: pbr(lib.backstop(), { normalScale: 1.2 }),
    stripes: new THREE.MeshStandardMaterial({ map: lib.stripes(), roughness: 0.8, metalness: 0.05 }),
    beam: new THREE.MeshStandardMaterial({ color: 0x2c3035, metalness: 0.8, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4a4f55, metalness: 0.9, roughness: 0.38 }),
    paintYellow: new THREE.MeshStandardMaterial({ color: 0xb8991a, roughness: 0.7, metalness: 0.1 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x3c4a40, metalness: 0.55, roughness: 0.55 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5b4630, roughness: 0.85, metalness: 0 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff0d4, emissiveIntensity: 2.4, roughness: 0.4 }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x35ff7a }),
    ledRed: new THREE.MeshBasicMaterial({ color: 0xff3a2e }),
  };

  function add(geo, mat, x, y, z, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (o.ry) m.rotation.y = o.ry;
    if (o.rx) m.rotation.x = o.rx;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.cast !== false;
    m.receiveShadow = o.receive !== false;
    (o.parent || root).add(m);
    if (o.occ) occluders.push(m);
    return m;
  }

  // ---------------- piso, paredes, teto ----------------
  const L = ROOM.maxZ - ROOM.minZ; // 31
  const W = ROOM.maxX - ROOM.minX; // 16
  const cz = (ROOM.maxZ + ROOM.minZ) / 2;

  const floor = add(tiledPlane(W, L, 3), M.concrete, 0, 0, cz, { rx: -Math.PI / 2, cast: false, occ: true });
  floor.name = 'piso';
  const ceiling = add(tiledPlane(W, L, 3), M.metalDark, 0, ROOM.h, cz, { rx: Math.PI / 2, cast: false, occ: true });
  ceiling.name = 'teto';

  // paredes: faixa inferior de concreto + painel metalico superior
  const lowH = 1.2;
  const upH = ROOM.h - lowH;
  const wallDefs = [
    { x: ROOM.minX, z: cz, w: L, ry: Math.PI / 2 },
    { x: ROOM.maxX, z: cz, w: L, ry: -Math.PI / 2 },
    { x: 0, z: ROOM.maxZ, w: W, ry: Math.PI },
  ];
  for (const d of wallDefs) {
    add(tiledPlane(d.w, lowH, 3), M.concreteDark, d.x, lowH / 2, d.z, { ry: d.ry, cast: false, occ: true });
    add(tiledPlane(d.w, upH, 2), M.metalWall, d.x, lowH + upH / 2, d.z, { ry: d.ry, cast: false, occ: true });
  }
  // parede do fundo com duas janelas gradeadas (por onde se ve o cenario externo)
  {
    const zb = ROOM.minZ;
    const piece = (x0, x1, y0, y1) => {
      if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return;
      if (y0 < lowH - 1e-6 && y1 > lowH + 1e-6) { piece(x0, x1, y0, lowH); piece(x0, x1, lowH, y1); return; }
      const low = y1 <= lowH + 1e-6;
      add(tiledPlane(x1 - x0, y1 - y0, low ? 3 : 2), low ? M.concreteDark : M.metalWall, (x0 + x1) / 2, (y0 + y1) / 2, zb, { cast: false, occ: true });
    };
    const WX0 = 4.4;
    const WX1 = 7.6;
    const WY0 = 0.9;
    const WY1 = 4.1;
    piece(-WX0, WX0, 0, ROOM.h);
    for (const sgn of [-1, 1]) {
      const a = sgn * WX0;
      const b = sgn * WX1;
      const c = sgn * ROOM.maxX;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const lo2 = Math.min(b, c);
      const hi2 = Math.max(b, c);
      piece(lo, hi, 0, WY0);
      piece(lo, hi, WY1, ROOM.h);
      piece(lo2, hi2, 0, ROOM.h);
      // moldura de ferro, peitoril e grades enferrujadas (algumas faltando)
      const cx = (a + b) / 2;
      const ww = WX1 - WX0;
      add(new THREE.BoxGeometry(ww + 0.3, 0.14, 0.3), M.beam, cx, WY1, zb + 0.1, { cast: false });
      add(new THREE.BoxGeometry(ww + 0.3, 0.16, 0.38), M.concrete, cx, WY0, zb + 0.14, { cast: false });
      add(new THREE.BoxGeometry(0.14, WY1 - WY0, 0.3), M.beam, lo, (WY0 + WY1) / 2, zb + 0.1, { cast: false });
      add(new THREE.BoxGeometry(0.14, WY1 - WY0, 0.3), M.beam, hi, (WY0 + WY1) / 2, zb + 0.1, { cast: false });
      // grades arrancadas: so restam dois ferros tortos nas pontas
      for (const gi of [0.5, ww - 0.5]) {
        add(new THREE.CylinderGeometry(0.014, 0.014, WY1 - WY0, 6), M.steel, lo + gi, (WY0 + WY1) / 2, zb + 0.08, { cast: false, rz: (gi < 1 ? 0.04 : -0.05) });
      }
      add(new THREE.BoxGeometry(ww, 0.05, 0.05), M.steel, cx, (WY0 + WY1) / 2 + 0.2, zb + 0.08, { cast: false });
    }
  }

  // colisores das paredes (caixas por fora da sala)
  colliders.push(makeBox(ROOM.minX - 1, ROOM.minZ - 1, ROOM.minX, ROOM.maxZ + 1));
  colliders.push(makeBox(ROOM.maxX, ROOM.minZ - 1, ROOM.maxX + 1, ROOM.maxZ + 1));
  colliders.push(makeBox(ROOM.minX - 1, ROOM.maxZ, ROOM.maxX + 1, ROOM.maxZ + 1));
  // parede do fundo: partes cheias + janelas com peitoril baixo (0,9 m: da para pular e sair) e verga alta
  colliders.push(makeBox(ROOM.minX - 1, ROOM.minZ - 1, -7.6, ROOM.minZ));
  colliders.push(makeBox(-4.4, ROOM.minZ - 1, 4.4, ROOM.minZ));
  colliders.push(makeBox(7.6, ROOM.minZ - 1, ROOM.maxX + 1, ROOM.minZ));
  for (const [a, b] of [[-7.6, -4.4], [4.4, 7.6]]) {
    colliders.push(makeBox(a, ROOM.minZ - 0.3, b, ROOM.minZ + 0.3, 0, 0.9));          // peitoril
    colliders.push(makeBox(a, ROOM.minZ - 1, b, ROOM.minZ, 4.1, 10));                   // verga
  }

  // faixa de seguranca amarela na junta concreto/metal
  add(new THREE.BoxGeometry(0.03, 0.07, L), M.paintYellow, ROOM.minX + 0.015, lowH, cz, { cast: false });
  add(new THREE.BoxGeometry(0.03, 0.07, L), M.paintYellow, ROOM.maxX - 0.015, lowH, cz, { cast: false });
  add(new THREE.BoxGeometry(W, 0.07, 0.03), M.paintYellow, 0, lowH, ROOM.maxZ - 0.015, { cast: false });

  // rodape de borracha
  add(new THREE.BoxGeometry(0.05, 0.12, L), M.rubber, ROOM.minX + 0.025, 0.06, cz, { cast: false });
  add(new THREE.BoxGeometry(0.05, 0.12, L), M.rubber, ROOM.maxX - 0.025, 0.06, cz, { cast: false });

  // nervuras verticais das paredes (instanciadas)
  {
    const ribZ = [];
    for (let z = -13; z <= 13; z += 2) ribZ.push(z); // numeros impares: nao coincidem com os pilastres
    const ribX = [];
    for (let x = -7; x <= 7; x += 2) ribX.push(x);
    const geoSide = new THREE.BoxGeometry(0.1, upH, 0.14);
    const geoBack = new THREE.BoxGeometry(0.14, upH, 0.1);
    const side = new THREE.InstancedMesh(geoSide, M.metalDark, ribZ.length * 2);
    let i = 0;
    for (const z of ribZ) {
      for (const sx of [-1, 1]) {
        _p.set(sx * (ROOM.maxX - 0.05), lowH + upH / 2, z);
        _m4.compose(_p, _q.identity(), _s);
        side.setMatrixAt(i++, _m4);
      }
    }
    side.receiveShadow = true;
    root.add(side);
    const back = new THREE.InstancedMesh(geoBack, M.metalDark, ribX.length);
    ribX.forEach((x, k) => {
      _p.set(x, lowH + upH / 2, ROOM.maxZ - 0.05);
      _m4.compose(_p, _q.identity(), _s);
      back.setMatrixAt(k, _m4);
    });
    back.receiveShadow = true;
    root.add(back);
  }

  // pilastres de concreto com base listrada
  for (const z of [8, 0, -8, -15]) {
    for (const sx of [-1, 1]) {
      const x = sx * 7.55;
      add(texturedBox(0.9, ROOM.h, 0.9, 3), M.concrete, x, ROOM.h / 2, z, { occ: true });
      add(texturedBox(0.94, 1.1, 0.94, 0.5), M.stripes, x, 0.55, z, { cast: false });
      colliders.push(makeBox(x - 0.45, z - 0.45, x + 0.45, z + 0.45));
    }
  }

  // ---------------- estrutura do teto ----------------
  {
    const beamZ = [13, 9.5, 6, 2.5, -1, -4.5, -8, -11.5, -15.5];
    const web = new THREE.InstancedMesh(new THREE.BoxGeometry(W - 0.1, 0.30, 0.03), M.beam, beamZ.length);
    const flange = new THREE.InstancedMesh(new THREE.BoxGeometry(W - 0.1, 0.04, 0.2), M.beam, beamZ.length * 2);
    beamZ.forEach((z, k) => {
      _p.set(0, ROOM.h - 0.2, z);
      _m4.compose(_p, _q.identity(), _s);
      web.setMatrixAt(k, _m4);
      _p.set(0, ROOM.h - 0.04, z);
      _m4.compose(_p, _q.identity(), _s);
      flange.setMatrixAt(k * 2, _m4);
      _p.set(0, ROOM.h - 0.36, z);
      _m4.compose(_p, _q.identity(), _s);
      flange.setMatrixAt(k * 2 + 1, _m4);
    });
    root.add(web, flange);
    // longarinas, tubulacao e eletrocalha
    for (const x of [-4.2, 4.2]) add(new THREE.BoxGeometry(0.3, 0.32, L), M.beam, x, ROOM.h - 0.55, cz, { cast: false });
    add(cylinderAlong('z', 0.11, L, 14), M.steel, -6.3, ROOM.h - 0.75, cz, { cast: false });
    add(cylinderAlong('z', 0.07, L, 12), M.steel, -6.0, ROOM.h - 0.95, cz, { cast: false });
    add(cylinderAlong('z', 0.09, L, 12), M.paintYellow, 6.4, ROOM.h - 0.8, cz, { cast: false });
    add(new THREE.BoxGeometry(0.45, 0.07, L), M.metalDark, -2.3, ROOM.h - 0.8, cz, { cast: false });
    for (const sx of [-0.2, 0.2]) add(new THREE.BoxGeometry(0.02, 0.1, L), M.metalDark, -2.3 + sx, ROOM.h - 0.74, cz, { cast: false });
  }

  // ---------------- iluminacao industrial ----------------
  const spots = [];
  const lightRows = [5, -4, -12];
  for (const z of lightRows) {
    for (const x of [-1.4, 1.4]) {
      add(roundedBox(1.6, 0.09, 0.24, 0.02), M.beam, x, 4.35, z, { cast: false });
      add(new THREE.BoxGeometry(1.5, 0.02, 0.18), M.lamp, x, 4.295, z, { cast: false, receive: false });
      for (const dx of [-0.7, 0.7]) {
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.55, 5), M.steel, x + dx, 4.65, z, { cast: false });
      }
    }
    const sp = new THREE.SpotLight(0xfff1de, 110, 30, 1.2, 0.75, 2);
    sp.position.set(0, 4.25, z);
    sp.target.position.set(0, 0, z - 1.5);
    sp.shadow.mapSize.set(1024, 1024);
    sp.shadow.camera.near = 0.6;
    sp.shadow.camera.far = 22;
    sp.shadow.bias = -0.0004;
    sp.shadow.normalBias = 0.02;
    scene.add(sp, sp.target);
    spots.push(sp);
  }
  const hemi = new THREE.HemisphereLight(0x9aa6b4, 0x2b2824, 0.5);   // (luz de apoio por ponto removida: menos luzes por pixel = mais fps)
  scene.add(hemi);

  // ---------------- area inicial segura ----------------
  const safeTex = markingTexture(12, 5.6, 64, (ctx, w, h, ppm) => {
    ctx.fillStyle = 'rgba(20,22,24,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d9b300';
    ctx.lineWidth = 7;
    ctx.setLineDash([46, 26]);
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(232,228,216,0.9)';
    ctx.font = 'bold 54px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ÁREA SEGURA', w / 2, h / 2 - 8);
    ctx.font = '26px "Arial Narrow", Arial, sans-serif';
    ctx.fillText('ARMA APONTADA PARA O ALVO • DEDO FORA DO GATILHO', w / 2, h / 2 + 38);
  }, aniso);
  const decalMat = (map) => new THREE.MeshStandardMaterial({
    map, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  add(new THREE.PlaneGeometry(12, 5.6), decalMat(safeTex), 0, 0.004, 11.0, { rx: -Math.PI / 2, cast: false });

  const lineTex = markingTexture(15, 0.9, 64, (ctx, w, h) => {
    ctx.fillStyle = '#d9b300';
    ctx.fillRect(0, h * 0.35, w, h * 0.18);
    ctx.fillStyle = 'rgba(232,228,216,0.85)';
    ctx.font = 'bold 30px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LINHA DE TIRO', w * 0.5, h * 0.78);
  }, aniso);
  add(new THREE.PlaneGeometry(15, 0.9), decalMat(lineTex), 0, 0.005, FIRING_LINE_Z + 0.05, { rx: -Math.PI / 2, cast: false });

  // porta de saida (decorativa) e placa luminosa
  {
    const dx = -4.5;
    add(new THREE.BoxGeometry(1.25, 2.2, 0.06), M.metalDark, dx, 1.1, ROOM.maxZ - 0.05, {});
    add(new THREE.BoxGeometry(0.1, 2.3, 0.1), M.beam, dx - 0.67, 1.15, ROOM.maxZ - 0.06, { cast: false });
    add(new THREE.BoxGeometry(0.1, 2.3, 0.1), M.beam, dx + 0.67, 1.15, ROOM.maxZ - 0.06, { cast: false });
    add(new THREE.BoxGeometry(1.45, 0.1, 0.1), M.beam, dx, 2.3, ROOM.maxZ - 0.06, { cast: false });
    add(new THREE.BoxGeometry(0.03, 0.03, 0.14), M.steel, dx + 0.45, 1.05, ROOM.maxZ - 0.14, { cast: false });
    const signMat = new THREE.MeshBasicMaterial({
      map: lib.textTexture('SAÍDA', { w: 256, h: 96, fg: '#35ff7a', bg: '#0b1a10', border: '#35ff7a', font: 'bold 54px Arial, sans-serif' }),
      toneMapped: false,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), signMat);
    sign.position.set(dx, 2.62, ROOM.maxZ - 0.07);
    sign.rotation.y = Math.PI;
    root.add(sign);
  }

  // armarios (lockers) junto a parede esquerda
  {
    const lockerGeo = roundedBox(0.52, 1.9, 0.55, 0.012);
    const slitGeo = new THREE.BoxGeometry(0.3, 0.02, 0.01);
    for (let k = 0; k < 3; k++) {
      const z = 13.25 - k * 0.55;
      add(lockerGeo, M.metalWall, ROOM.minX + 0.28, 0.95, z, { ry: Math.PI / 2 });
      for (let s = 0; s < 3; s++) add(slitGeo, M.beam, ROOM.minX + 0.56, 1.6 + s * 0.05, z, { ry: Math.PI / 2, cast: false });
      add(new THREE.BoxGeometry(0.02, 0.1, 0.02), M.steel, ROOM.minX + 0.57, 1.1, z + 0.17, { cast: false });
    }
    colliders.push(makeBox(ROOM.minX, 11.9, ROOM.minX + 0.56, 13.55));
    // bloco invisivel so para o raycast (balas e camera nao atravessam os armarios)
    const block = add(new THREE.BoxGeometry(0.56, 1.9, 1.65), M.metalWall, ROOM.minX + 0.28, 0.95, 12.72, { cast: false, receive: false, occ: true });
    block.visible = false;
  }
  // bancada de preparo
  {
    add(roundedBox(2.0, 0.07, 0.6, 0.015), M.wood, 4.2, 0.9, 13.2, { occ: true });
    for (const dx of [-0.9, 0.9]) for (const dz of [-0.24, 0.24]) add(new THREE.BoxGeometry(0.06, 0.9, 0.06), M.steel, 4.2 + dx, 0.45, 13.2 + dz, {});
    add(roundedBox(0.5, 0.28, 0.32, 0.02), M.crate, 3.6, 1.07, 13.2, {});
    add(roundedBox(0.34, 0.2, 0.26, 0.02), M.crate, 4.5, 1.03, 13.15, { ry: 0.4 });
    colliders.push(makeBox(3.15, 12.85, 5.25, 13.55));
  }

  // ---------------- linha de tiro: baias e barreiras ----------------
  function ballisticPanel(x, z, width, height = 2.2, ry = 0) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    root.add(g);
    const panel = add(roundedBox(width - 0.14, height - 0.3, 0.12, 0.02), M.rubber, 0, 0.3 + (height - 0.3) / 2, 0, { parent: g, occ: true });
    for (const sx of [-1, 1]) {
      add(roundedBox(0.1, height, 0.2, 0.015), M.steel, sx * (width / 2 - 0.05), height / 2, 0, { parent: g });
      add(roundedBox(0.1, 0.06, 0.55, 0.01), M.steel, sx * (width / 2 - 0.05), 0.03, 0, { parent: g });
    }
    add(roundedBox(width, 0.08, 0.2, 0.015), M.steel, 0, height - 0.04, 0, { parent: g });
    add(roundedBox(width, 0.1, 0.2, 0.015), M.steel, 0, 0.28, 0, { parent: g });
    const bb = aabbOfRotated(width, 0.22, ry);
    colliders.push(makeBox(x - bb.w / 2, z - bb.d / 2, x + bb.w / 2, z + bb.d / 2, 0, height));
    panel.userData.ballistic = true;
    return g;
  }

  // divisorias das baias de tiro
  for (const sx of [-1, 1]) ballisticPanel(sx * 2.7, FIRING_LINE_Z, 3.0, 2.1, Math.PI / 2);
  // barreiras de concreto nas extremidades da linha
  for (const sx of [-1, 1]) {
    add(roundedBox(2.6, 0.85, 0.55, 0.05), M.concrete, sx * 5.6, 0.425, FIRING_LINE_Z, { occ: true });
    colliders.push(makeBox(sx * 5.6 - 1.3, FIRING_LINE_Z - 0.28, sx * 5.6 + 1.3, FIRING_LINE_Z + 0.28, 0, 0.85));
  }

  // ---------------- area de tiro: coberturas ----------------
  ballisticPanel(-4.6, 2.0, 2.0);
  ballisticPanel(4.6, 2.0, 2.0);
  ballisticPanel(-3.4, -11.0, 1.8);
  ballisticPanel(3.4, -11.0, 1.8);

  // barreira baixa de concreto (tipo jersey)
  add(roundedBox(2.4, 0.85, 0.5, 0.06), M.concrete, -1.6, 0.425, -5.2, { occ: true });
  colliders.push(makeBox(-2.8, -5.45, -0.4, -4.95, 0, 0.85));

  function crateBox(w, h, d, x, y, z, ry = 0) {
    const m = add(texturedBox(w, h, d, 1.0), M.crate, x, y, z, { ry, occ: true });
    // cantoneiras metalicas
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      add(new THREE.BoxGeometry(0.05, h + 0.02, 0.05), M.steel, sx * (w / 2), 0, sz * (d / 2), { parent: m, cast: false });
    }
    return m;
  }
  // pilha de caixas
  crateBox(1.0, 1.0, 1.0, -5.8, 0.5, -0.5, 0.15);
  crateBox(1.0, 1.0, 1.0, -5.75, 0.5, 0.62, -0.1);
  crateBox(0.9, 0.9, 0.9, -5.78, 1.45, -0.45, 0.45);
  colliders.push(makeBox(-6.45, -1.1, -5.15, 1.25, 0, 1.9));
  // caixa grande
  {
    const yaw = 0.3;
    crateBox(1.2, 0.8, 0.8, 5.8, 0.4, 1.5, yaw);
    const bb = aabbOfRotated(1.2, 0.8, yaw);
    colliders.push(makeBox(5.8 - bb.w / 2, 1.5 - bb.d / 2, 5.8 + bb.w / 2, 1.5 + bb.d / 2, 0, 0.8));
  }
  crateBox(1.1, 0.9, 0.9, -5.4, 0.45, -9.5, 0.2);
  colliders.push(makeBox(-6.1, -10.1, -4.7, -8.9, 0, 0.9));

  // barris (inflamaveis: explodem quando atingidos por tiro ou granada)
  const worldBarrels = [];
  const barrelGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.92, 20);
  const ringGeo = new THREE.CylinderGeometry(0.305, 0.305, 0.035, 20);
  for (const [bx, bz] of [[5.5, -6.5], [6.35, -6.0]]) {
    const b = add(barrelGeo, M.barrel, bx, 0.46, bz, { occ: true });
    for (const ry of [-0.3, 0, 0.3]) add(ringGeo, M.barrel, 0, ry, 0, { parent: b, cast: false });
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 16), M.steel, 0, 0.465, 0, { parent: b, cast: false });
    const bcol = makeCircle(bx, bz, 0.3, 0, 0.92);
    colliders.push(bcol);
    b.userData.barrel = true;
    worldBarrels.push({ x: bx, z: bz, r: 0.3, h: 0.92, mesh: b, col: bcol });
  }

  // anteparo de contencao no fundo
  {
    const bs = add(roundedBox(8.4, 3.5, 0.4, 0.04), M.backstop, 0, 1.75, ROOM.minZ + 0.25, { occ: true });
    bs.name = 'anteparo';
    add(roundedBox(8.6, 0.12, 0.5, 0.02), M.steel, 0, 3.54, ROOM.minZ + 0.25, { cast: false });
    add(roundedBox(8.6, 0.2, 0.5, 0.02), M.steel, 0, 0.1, ROOM.minZ + 0.25, { cast: false });
    for (const sx of [-1, 1]) add(roundedBox(0.2, 3.5, 0.5, 0.02), M.steel, sx * 4.3, 1.75, ROOM.minZ + 0.25, { cast: false });
  }

  // placas de distancia penduradas
  const signs = [[-0.5, '6 m'], [-7.5, '13 m'], [-14, '19 m']];
  for (const [sz, text] of signs) {
    const mat = new THREE.MeshBasicMaterial({
      map: lib.textTexture(text, { w: 256, h: 96, font: 'bold 62px "Arial Narrow", Arial, sans-serif' }),
      toneMapped: false,
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.41), mat);
    sign.position.set(0, 3.55, sz);
    root.add(sign);
    for (const dx of [-0.5, 0.5]) add(new THREE.CylinderGeometry(0.008, 0.008, 1.2, 5), M.steel, dx, 4.15, sz - 0.01, { cast: false });
  }

  // LEDs de estado (detalhe)
  add(new THREE.BoxGeometry(0.06, 0.06, 0.02), M.ledGreen, ROOM.maxX - 0.02, 2.2, 12.5, { cast: false, receive: false, ry: -Math.PI / 2 });
  add(new THREE.BoxGeometry(0.06, 0.06, 0.02), M.ledRed, ROOM.maxX - 0.02, 2.2, 12.7, { cast: false, receive: false, ry: -Math.PI / 2 });

  // ---------------- alvos ----------------
  const tMats = makeTargetMaterials();
  const targets = [];
  const addTarget = (cfg) => {
    const x0 = cfg.x, z0 = cfg.z;
    const t = new Target({ ...cfg, lib, mats: tMats });
    root.add(t.root);
    targets.push(t);
    t.collider = makeCircle(x0, z0, t.kind === 'plate' ? 0.3 : 0.34, 0, 1.9);
    colliders.push(t.collider);
    for (const m of t.meshes) occluders.push(m); // (usado tambem como lista de alvos pelo raycast; filtrado por userData.target)
    return t;
  };
  // proximos (6 m)
  for (const x of [-3, -1, 1, 3]) addTarget({ kind: 'silhouette', x, z: -0.5 });
  // medios (13 m)
  addTarget({ kind: 'plate', x: -5, z: -7.5 });
  addTarget({ kind: 'silhouette', x: -2, z: -7.5 });
  addTarget({ kind: 'silhouette', x: 2, z: -7.5 });
  addTarget({ kind: 'plate', x: 5, z: -7.5 });
  // distantes (19 m)
  addTarget({ kind: 'silhouette', x: -4.5, z: -14 });
  addTarget({ kind: 'plate', x: 0, z: -14, radius: 0.16 });
  addTarget({ kind: 'silhouette', x: 4.5, z: -14 });
  // moveis
  addTarget({ kind: 'silhouette', x: -6, z: -3.2, move: { type: 'pingpong', min: -6.2, max: 6.2, speed: 1.7, phase: 0 } });
  addTarget({ kind: 'plate', x: 0, z: -10.2, move: { type: 'sine', cx: 0, amp: 5.2, period: 6.5, phase: 0 } });

  // ---------------- caixas de municao (achar mais durante a partida) ----------------
  const pickups = [];
  {
    const boxGeo = roundedBox(0.46, 0.26, 0.32, 0.02);
    const bandGeo = new THREE.BoxGeometry(0.47, 0.05, 0.33);
    const bulletGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.085, 8);
    const tipGeo = new THREE.ConeGeometry(0.018, 0.04, 8);
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.3 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 36);
    const bandGreen = new THREE.MeshStandardMaterial({ color: 0x3e8f45, roughness: 0.5, metalness: 0.1 });
    const ringMatGreen = ringMat.clone();
    ringMatGreen.color.set(0x6ee06e);
    // 'usp' = municao de pistola (faixa amarela); 'mp40' = municao de MP40 (faixa verde). Dentro da sala e no cenario externo.
    const spots = [
      [-5.2, 8.6, 'short'], [5.2, 8.6, 'long'], [3.8, -3.2, 'short'], [-6.3, -6.5, 'long'], [6.3, -12.3, 'short'],
      [0, -24, 'short'], [-24, -36, 'long'], [26, -35, 'short'], [-10, -36, 'long'], [36, -45, 'long'], [-50, -34, 'short'],
    ];
    spots.forEach(([px, pz, kind], i) => {
      const g = new THREE.Group();
      g.userData.dynamic = true;
      g.position.set(px, 0, pz);
      root.add(g);
      const body = new THREE.Group();
      g.add(body);
      const box = new THREE.Mesh(boxGeo, M.crate);
      box.castShadow = true;
      body.add(box);
      const band = new THREE.Mesh(bandGeo, kind === 'long' ? bandGreen : M.paintYellow);
      band.position.y = 0.03;
      body.add(band);
      for (let k = -1; k <= 1; k++) {
        const b = new THREE.Mesh(bulletGeo, brass);
        b.position.set(k * 0.06, 0.175, 0);
        body.add(b);
        const t = new THREE.Mesh(tipGeo, M.steel);
        t.position.set(k * 0.06, 0.24, 0);
        body.add(t);
      }
      body.position.y = 0.5;
      const ring = new THREE.Mesh(ringGeo, kind === 'long' ? ringMatGreen : ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      g.add(ring);
      pickups.push({ group: g, body, ring, kind, x: px, z: pz, active: true, timer: 0, phase: i * 1.3 });
    });
  }
  const PICKUP_RESPAWN = 30;
  const PICKUP_RADIUS = 0.95;

  // ---------------- API ----------------
  const targetMeshes = [];
  for (const t of targets) for (const m of t.meshes) targetMeshes.push(m);
  const sceneryOccluders = occluders.filter((m) => !m.userData.target);

  const shadowOrder = [1, 0, 2]; // quais spots projetam sombra conforme a qualidade
  function setShadowQuality(count, mapSize) {
    spots.forEach((s, i) => {
      const on = shadowOrder.indexOf(i) < count;
      s.castShadow = on;
      if (s.shadow.mapSize.x !== mapSize) {
        s.shadow.mapSize.set(mapSize, mapSize);
        if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
      }
    });
  }

  const ringMatPulse = (t) => { const o = 0.42 + 0.2 * Math.sin(t * 3); for (const p of pickups) p.ring.material.opacity = o; };

  return {
    root,
    colliders,
    barrels: worldBarrels,
    occluders: sceneryOccluders, // paredes, piso, teto, coberturas
    targetMeshes,
    targets,
    spots,
    hemi,
    setShadowQuality,
    pickups,
    update(dt, time) {
      for (const t of targets) { t.update(dt, time); if (t.moving) moveCircle(t.collider, t.root.position.x, t.root.position.z); }
      for (const p of pickups) {
        if (!p.active) {
          p.timer -= dt;
          if (p.timer <= 0) { p.active = true; p.group.visible = true; }
          continue;
        }
        p.body.rotation.y += dt * 1.6;
        p.body.position.y = 0.5 + Math.sin(time * 2.4 + p.phase) * 0.06;
      }
      ringMatPulse(time);
    },
    /** Coleta as caixas ao alcance (xz). Retorna a lista dos tipos pegos ('usp' | 'mp40'). */
    collectNear(x, z, y = 0) {
      const n = [];
      if (Math.abs(y) > 1.6) return n;
      for (const p of pickups) {
        if (!p.active) continue;
        const dx = p.x - x;
        const dz = p.z - z;
        if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) { p.active = false; p.timer = PICKUP_RESPAWN; p.group.visible = false; n.push(p.kind); }
      }
      return n;
    },
    resetTargets() {
      for (const t of targets) t.reset();
      for (const p of pickups) { p.active = true; p.timer = 0; p.group.visible = true; }
    },
  };
}
