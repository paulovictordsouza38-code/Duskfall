// Itens espalhados pelo mapa: armas, mira 4x e caixas de municao (curta e longa). Posicoes sorteadas com semente fixa
// (sempre as mesmas), longe de paredes/objetos solidos, em 9 setores do terreno + dentro da sala de tiro.
import * as THREE from 'three';
import { resolveMovement, terrainAt } from './logic/collision.js';
import { createUSP, createMP40 } from './weapons3d.js';
import { GUN_BUILDERS, createScope4x } from './guns.js';
import { WEAPON_IDS } from './logic/weapons.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Chumbo escuro com uma caveira e ossos cruzados (desenhada em canvas). */
function skullTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#464c52'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#2c3034'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
  g.strokeStyle = '#8a929a'; g.lineWidth = 2; g.strokeRect(9, 9, 110, 110);
  // ossos cruzados
  g.strokeStyle = '#d9d9cf'; g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.moveTo(26, 98); g.lineTo(102, 56); g.moveTo(102, 98); g.lineTo(26, 56); g.stroke();
  g.fillStyle = '#d9d9cf';
  for (const [x, y] of [[24, 100], [104, 100], [24, 54], [104, 54]]) { g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); }
  // caveira
  g.fillStyle = '#ecece4';
  g.beginPath(); g.ellipse(64, 54, 27, 25, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(46, 66, 36, 26);
  g.fillStyle = '#20252a';
  g.beginPath(); g.arc(53, 54, 8, 0, Math.PI * 2); g.arc(75, 54, 8, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(64, 62); g.lineTo(59, 72); g.lineTo(69, 72); g.closePath(); g.fill();
  g.fillRect(51, 82, 2.5, 10); g.fillRect(58, 82, 2.5, 10); g.fillRect(65.5, 82, 2.5, 10); g.fillRect(73, 82, 2.5, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildRig(id, lib) {
  if (id === 'usp') return createUSP(lib);
  if (id === 'mp40') return createMP40(lib);
  return GUN_BUILDERS[id](lib);
}

export function createPickups(scene, lib, colliders) {
  const items = [];
  const root = new THREE.Group();
  root.name = 'itens';
  scene.add(root);

  const ringGeo = new THREE.RingGeometry(0.5, 0.64, 36);
  const ringMats = {};
  const ringMat = (hex) => ringMats[hex] || (ringMats[hex] = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x5b5a3c, roughness: 0.8, metalness: 0.1 });
  const bandY = new THREE.MeshStandardMaterial({ color: 0xd9b300, roughness: 0.5 });
  const bandG = new THREE.MeshStandardMaterial({ color: 0x3e8f45, roughness: 0.5 });
  const crateGeo = new THREE.BoxGeometry(0.46, 0.26, 0.32);
  const bandGeo = new THREE.BoxGeometry(0.47, 0.05, 0.33);
  // caixa de loot de quem morreu: menor, cinza-chumbo, com uma caveira desenhada em todas as faces
  const deathMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: skullTexture(), roughness: 0.55, metalness: 0.55 });
  const deathGeo = new THREE.BoxGeometry(0.5, 0.3, 0.36);

  const cache = {};
  const C = (key, fn) => cache[key] || (cache[key] = fn());   // geometria/material compartilhados: menos memoria e menos trocas na GPU
  function free(x, z) {
    const p = { x, z };
    return !resolveMovement(p, 0.95, colliders, 1, 0);
  }

  /** Desenho 3D de um item (usado no mapa e nos icones da pre-visualizacao). */
  function makeVisual(type, id) {
    const body = new THREE.Group();
    body.position.y = 0.95;
    let ringColor = 0xff7a2a;
    if (type === 'weapon') {
      const rig = buildRig(id, lib);
      rig.group.visible = true;
      rig.group.scale.setScalar(1.6);
      rig.group.position.set(0, 0, 0);
      body.add(rig.group);
      body.userData.weaponRig = rig;
    } else if (type === 'scope') {
      const s = createScope4x(lib);
      s.scale.setScalar(1.7);
      body.add(s);
      ringColor = 0x35d6ff;
    } else if (type === 'bandage' || type === 'medkit') {
      body.position.y = 0.5;
      const med = type === 'medkit';
      const bx = new THREE.Mesh(C('bg' + med, () => new THREE.BoxGeometry(med ? 0.5 : 0.34, med ? 0.3 : 0.12, med ? 0.34 : 0.22)), C('bm' + med, () => new THREE.MeshStandardMaterial({ color: med ? 0xe9e9e4 : 0xf2f2ee, roughness: 0.6 })));
      const red = C('red', () => new THREE.MeshStandardMaterial({ color: 0xd32a2a, roughness: 0.5 }));
      const c1 = new THREE.Mesh(C('c1' + med, () => new THREE.BoxGeometry(med ? 0.28 : 0.2, 0.02, med ? 0.07 : 0.05)), red);
      const c2 = new THREE.Mesh(C('c2' + med, () => new THREE.BoxGeometry(med ? 0.07 : 0.05, 0.02, med ? 0.28 : 0.2)), red);
      const top = (med ? 0.15 : 0.06) + 0.012;
      c1.position.y = top; c2.position.y = top;
      body.add(bx, c1, c2);
      ringColor = med ? 0xff4a4a : 0xffffff;
    } else if (type === 'frag' || type === 'gel') {
      body.position.y = 0.55;
      const gel = type === 'gel';
      const gm = new THREE.Mesh(C('sg', () => new THREE.SphereGeometry(0.15, 12, 8)), C('gm' + gel, () => new THREE.MeshStandardMaterial({ color: gel ? 0x8fd8ff : 0x4a5a3a, roughness: 0.4, metalness: 0.3, emissive: gel ? 0x2a79b0 : 0x000000, emissiveIntensity: 0.8 })));
      const cap = new THREE.Mesh(C('cg', () => new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8)), C('cm', () => new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7, roughness: 0.4 })));
      cap.position.y = 0.17;
      body.add(gm, cap);
      ringColor = gel ? 0x66ddff : 0xff8a2a;
    } else if (type === 'crate') {
      body.position.y = 0.3;
      body.add(new THREE.Mesh(deathGeo, deathMat));
      ringColor = 0xb8c2cc;
    } else {
      body.position.y = 0.5;
      const box = new THREE.Mesh(crateGeo, crateMat);
      const band = new THREE.Mesh(bandGeo, id === 'long' ? bandG : bandY);
      band.position.y = 0.03;
      box.castShadow = true;
      body.add(box, band);
      if (id === 'long') { box.scale.set(1.15, 1.15, 1.15); band.scale.set(1.15, 1.15, 1.15); }
      ringColor = id === 'long' ? 0x6ee06e : 0xffd23a;
    }
    return { body, ringColor };
  }

  function add(type, id, x, z, extra = {}) {
    const g = new THREE.Group();
    g.userData.dynamic = true;
    const gy = extra.gy === undefined ? terrainAt(x, z) : extra.gy;   // morros: o item acompanha o chao
    g.position.set(x, gy, z);
    const vis = makeVisual(type, id);
    const body = vis.body, ringColor = vis.ringColor;
    g.add(body);
    const ring = new THREE.Mesh(ringGeo, ringMat(ringColor));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    g.add(ring);
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    root.add(g);
    const it = { type, id, x, z, group: g, body, active: true, baseY: body.position.y, phase: items.length * 0.9, ...extra };
    items.push(it);
    return it;
  }

  /** Larga um item no chao (descarte ou arma trocada). Fica sem poder ser pego por 3 s. */
  function drop(type, id, x, z, time = 0, gy) {
    const dropped = items.filter((i) => i.dropped && i.type !== 'crate');
    if (dropped.length > 40) { const o = dropped[0]; root.remove(o.group); items.splice(items.indexOf(o), 1); }
    const it = add(type, id, x, z, { dropped: true, retry: time + 3, ...(gy === undefined ? {} : { gy }) });
    return it;
  }

  /** Caixa de loot deixada por quem morreu. contents = { guns:[{id,mag,reserve}], items:{bandage,medkit,frag,gel}, scope4x } */
  function dropCrate(x, z, gy, contents, cid = '') {
    const old = items.filter((i) => i.type === 'crate');
    if (old.length >= 24) { const o = old[0]; root.remove(o.group); items.splice(items.indexOf(o), 1); }
    return add('crate', 'loot', x, z, { dropped: true, retry: 0, ...(gy === undefined ? {} : { gy }), contents, cid });
  }

  // ---- 1) fixos: MP40 no meio da sala (como antes)
  add('weapon', 'mp40', 0, -2);

  // ---- 2) sorteio
  const R = rng(20261101);
  const placed = [{ x: 0, z: -2 }];
  const far = (x, z, d) => placed.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > d * d);
  function place(x0, x1, z0, z1, minDist = 5) {
    for (let k = 0; k < 80; k++) {
      const x = x0 + R() * (x1 - x0);
      const z = z0 + R() * (z1 - z0);
      if (free(x, z) && far(x, z, minDist)) { placed.push({ x, z }); return [x, z]; }
    }
    return null;
  }
  const put = (type, id, region, minDist) => {
    const pos = place(region[0], region[1], region[2], region[3], minDist);
    if (pos) add(type, id, pos[0], pos[1]);
  };

  // dentro da sala de tiro
  const room = [-6.4, 6.4, -13, 11];
  put('weapon', 'g18', room, 3);
  put('weapon', 'mp5', room, 3);
  put('ammo', 'short', room, 3);
  put('ammo', 'short', room, 3);
  put('ammo', 'long', room, 3);
  put('bandage', 'a', room, 3);
  put('medkit', 'k', room, 3);
  put('frag', 'f', room, 3);

  // fora: 3 x 3 setores
  const xs = [[-62, -21], [-21, 21], [21, 62]];
  const zs = [[-112, -84], [-84, -54], [-54, -24]];
  const sectors = [];
  for (const z of zs) for (const x of xs) sectors.push([x[0], x[1], z[0], z[1]]);
  const list = [
    ...Array(16).fill(['bandage', 'a']), ...Array(9).fill(['medkit', 'k']), ...Array(10).fill(['frag', 'f']), ...Array(6).fill(['gel', 'g']),
    ['weapon', 'xm8'], ['weapon', 'famas'], ['weapon', 'scar'], ['weapon', 'awm'],
    ['weapon', 'xm8'], ['weapon', 'famas'], ['weapon', 'scar'], ['weapon', 'awm'],
    ['weapon', 'mp5'], ['weapon', 'g18'], ['weapon', 'mp40'],
    ['scope', '4x'], ['scope', '4x'], ['scope', '4x'], ['scope', '4x'], ['scope', '4x'],
    ['ammo', 'long'], ['ammo', 'long'], ['ammo', 'long'], ['ammo', 'long'], ['ammo', 'long'],
    ['ammo', 'long'], ['ammo', 'long'], ['ammo', 'long'], ['ammo', 'long'],
    ['ammo', 'short'], ['ammo', 'short'], ['ammo', 'short'], ['ammo', 'short'], ['ammo', 'short'], ['ammo', 'short'],
  ];
  // embaralha com a semente (os mesmos itens nao caem juntos no mesmo setor)
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  list.forEach(([type, id], i) => put(type, id, sectors[i % sectors.length], 6));

  return {
    items,
    update(dt, time, px, pz) {
      for (const it of items) {
        const dx = it.x - px;
        const dz = it.z - pz;
        const lim = it.type === 'weapon' || it.type === 'crate' ? 30 : 24;
        const near = it.active && dx * dx + dz * dz < lim * lim;
        if (it.group.visible !== near) it.group.visible = near;
        if (!near) continue;
        it.body.rotation.y += dt * (it.type === 'weapon' ? 1.1 : 1.6);
        it.body.position.y = it.baseY + Math.sin(time * 2.2 + it.phase) * 0.06;
      }
    },
    /** Coleta o que estiver ao alcance. Retorna [{type, id}] */
    collect(x, z, y, time = 0) {
      const out = [];
      for (const it of items) {
        if (!it.active || (it.retry && it.retry > time)) continue;
        if (Math.abs(y - (it.gy || 0)) > 1.6) continue;
        const dx = it.x - x;
        const dz = it.z - z;
        const r = it.type === 'weapon' || it.type === 'scope' || it.type === 'crate' ? 1.15 : 0.95;
        if (dx * dx + dz * dz < r * r) { it.active = false; it.group.visible = false; out.push({ type: it.type, id: it.id, item: it }); }
      }
      return out;
    },
    /** Devolve um item ao chao (ex.: nao pode ser usado agora). */
    release(it, time = 0) { it.active = true; it.group.visible = true; it.retry = time + 4; },
    reset() {
      for (let i = items.length - 1; i >= 0; i--) if (items[i].dropped) { root.remove(items[i].group); items.splice(i, 1); }
      for (const it of items) { it.active = true; it.retry = 0; }
    },
    drop,
    dropCrate,
    remove(it) { const k = items.indexOf(it); if (k >= 0) { root.remove(it.group); items.splice(k, 1); } },
    /** Itens ao alcance (pre-visualizacao). Mais perto primeiro. */
    nearby(x, z, y, time = 0, maxN = 3) {
      const out = [];
      for (const it of items) {
        if (!it.active || (it.retry && it.retry > time)) continue;
        if (Math.abs(y - (it.gy || 0)) > 1.6) continue;
        const dx = it.x - x, dz = it.z - z;
        const r = it.type === 'weapon' || it.type === 'scope' || it.type === 'crate' ? 1.7 : 1.4;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) out.push([d2, it]);
      }
      out.sort((a, b) => a[0] - b[0]);
      return out.slice(0, maxN).map((o) => o[1]);
    },
    visual: makeVisual,
    /** Item fixo em andar alto / laje (gy = altura do piso). */
    place(type, id, x, z, gy) { return add(type, id, x, z, gy === undefined ? {} : { gy }); },
    WEAPON_IDS,
  };
}
