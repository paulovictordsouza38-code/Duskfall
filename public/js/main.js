// Sala de Treinamento — laco principal: renderizador, personagem, camera hibrida (3a pessoa <-> 1a pessoa
// ao mirar), armas, tiro por raycast, alvos, pontuacao e interface.
import * as THREE from 'three';
import { createTextureLib } from './textures.js';
import { buildWorld, buildEnvironment, ROOM, SPAWN } from './world.js';
import { Character, wrapAngle } from './character.js';
import { SoldadoSkin } from './soldado.js';
import { createUSP, createMP40 } from './weapons3d.js';
import { GUN_BUILDERS } from './guns.js';
import { createPickups } from './pickups.js';
import { createIcons } from './icons.js';
import { Effects } from './effects.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { HudLayout } from './hudlayout.js';
import { Net } from './net.js';
import { BotManager } from './bots.js';
import { Online } from './online.js';
import { mergeStaticMeshes } from './merge.js';
import { Explosives, EXPLOSIVE_STATS } from './explosives.js';
import { Vitals, Backpack, shotDamage, HP_MAX, EP_MAX, USE_TIME, ITEM_CAP, ITEM_NAMES, fallDamage, explosionDamage } from './logic/combat.js';
import { buildScenery } from './scenery.js';
import { DROP, newDrop, openChute, stepDrop, heliAt } from './logic/airdrop.js';
import { createHeli, createChute, DOOR } from './airdrop.js';
import { Loadout, WEAPONS, WEAPON_IDS, zoomFor } from './logic/weapons.js';
import { Stats } from './logic/scoring.js';
import { resolveMovement, rayBoxes, rayShot, groundHeight, makeBox, makeCircle, terrainAt } from './logic/collision.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

const PLAYER_RADIUS = 0.34;
const WALK = 2.6;
const RUN = 5.2;
const AIM_WALK = 1.8;
const NADE_SPEED = 24;       // alcance da granada (era 15)
const DAMAGE_TAKEN = 0.55;   // vida dura mais: dano recebido x0.55
const PRONE_WALK = 1.1, PRONE_AIM = 0.8;
const ADS_BASE_FOV = 52;
// campo de visao vertical com a mira: 52 graus nas miras de ferro; luneta 2x/4x/8x divide a tangente
const adsFov = (zoom) => (2 * Math.atan(Math.tan((ADS_BASE_FOV * Math.PI) / 360) / zoom) * 180) / Math.PI;
const TP_FOV = 66;

// ------------------------------------------------------------------ qualidade
const QUALITY = {
  baixa: { pixel: 0.9, shadows: 0, shadowSize: 512, tex: 256, lights: 1 },
  media: { pixel: 1, shadows: 1, shadowSize: 1024, tex: 512, lights: 2 },
  alta: { pixel: 1.25, shadows: 2, shadowSize: 1024, tex: 512, lights: 3 },
};
function detectQuality() {
  try { const s = localStorage.getItem('sala_quality'); if (s && QUALITY[s]) return s; } catch (e) { /* sem storage */ }
  const mobile = matchMedia('(pointer: coarse)').matches;
  return mobile ? 'baixa' : 'media';
}
let qualityName = detectQuality();
let askedLite = false;
let resScale = 1, resScaleCap = 1, adaptT = 0, lowFps = 0;        // resolucao dinamica: cai sozinha quando o fps cai e volta quando sobra folga

// ------------------------------------------------------------------ renderizador
const canvas = $('game');
const COARSE = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !COARSE, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // sombras atualizadas sob controle (menos custo por quadro)

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbcd9f2);
scene.fog = new THREE.Fog(0xbcd9f2, 60, 320);   // dia de sol, ceu azul
const camera = new THREE.PerspectiveCamera(TP_FOV, 1, 0.03, 700);
scene.add(camera);

const lib = createTextureLib(renderer, { size: QUALITY[qualityName].tex });
scene.environment = buildEnvironment(renderer);
scene.environmentIntensity = 0.45;
const world = buildWorld(scene, lib, renderer);
// luzes naturais: sol quente (so ao ar livre), luz de ceu mais forte fora da sala e uma luz de apoio que acompanha o jogador
const sun = new THREE.DirectionalLight(0xfff0d2, 0);
sun.position.set(-40, 70, -30);
scene.add(sun, sun.target);
const keyLight = new THREE.DirectionalLight(0xfff6e8, 0.7);
scene.add(keyLight, keyLight.target);
const skyFill = new THREE.HemisphereLight(0xbfdcff, 0x8c7d66, 0);
scene.add(skyFill);
const HEMI_BASE = world.hemi.intensity;
const scenery = buildScenery(scene, lib, renderer);
for (const c of scenery.colliders) world.colliders.push(c); // da para sair pelas janelas; predios e guindastes sao solidos
for (const e of scenery.elevators) e.group.userData.noAuto = true;

/**
 * Rede de seguranca contra "atravessar paredes": todo bloco alto e fixo do cenario (muro, container, pilar, parede)
 * que ainda nao tenha colisor ganha um colisor com a sua caixa envolvente. Degraus, corrimaos e coisas finas ficam de fora.
 */
function autoColliders(root, list) {
  const box = new THREE.Box3();
  const sz = new THREE.Vector3();
  let added = 0;
  root.updateMatrixWorld(true);
  const covered = (b) => {
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    for (const c of list) {
      if (cx < c.minX || cx > c.maxX || cz < c.minZ || cz > c.maxZ) continue;
      if (c.maxY >= b.max.y - 0.5 && c.minY <= b.min.y + 0.8) return true;
    }
    return false;
  };
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) return;
    for (let p = o; p; p = p.parent) if (p.userData && (p.userData.noAuto || p.userData.dynamic)) return;
    const m = o.material;
    if (!m || m.transparent || m.opacity < 1) return;
    box.setFromObject(o);
    box.getSize(sz);
    if (sz.y < 1.2 || box.min.y > 0.3 || box.max.y > 40) return;       // so blocos altos que partem do chao
    if (Math.min(sz.x, sz.z) < 0.18 || Math.max(sz.x, sz.z) > 12) return;
    if (box.min.x < -75 || box.max.x > 75) return;
    if (covered(box)) return;
    list.push(makeBox(box.min.x, box.min.z, box.max.x, box.max.z, Math.max(0, box.min.y), box.max.y));
    added++;
  });
  return added;
}
const autoAdded = autoColliders(scenery.root, world.colliders);
if (autoAdded) console.info('colisores automaticos adicionados:', autoAdded);

// objetos estaticos da sala nao recalculam matriz a cada quadro (menos custo de CPU, menos atraso)
(function freezeStatic() {
  const f = (o) => {
    if (o.userData && o.userData.dynamic) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    for (const c of o.children) f(c);
  };
  for (const c of world.root.children) f(c);
  world.root.updateMatrixWorld(true);
  for (const e of scenery.elevators) e.group.userData.dynamic = true;
  for (const c of scenery.root.children) f(c);   // cenario externo tambem e fixo (so ceu, sol e elevadores se mexem)
  scenery.root.updateMatrixWorld(true);
})();

// junta o cenario fixo em poucos blocos: o celular desenha bem menos coisas por quadro (visual igual)
try {
  const mr = mergeStaticMeshes(THREE, scenery.root);
  console.info('cenario: malhas', mr.before, '->', mr.after);
} catch (err) { console.warn('fusao do cenario ignorada:', err); }

// MODO LEVE: so liga quando voce escolhe qualidade Baixa, quando liga o botao nas configuracoes ou quando aceita a pergunta. Nunca sozinho.
let leve = false;
try { const sv = localStorage.getItem('sala_leve'); leve = sv === null ? qualityName === 'baixa' : sv === '1'; } catch (e) { /* sem storage */ }
function pixelNow() { const q = QUALITY[qualityName]; return Math.min(devicePixelRatio || 1, q.pixel * (leve ? 0.85 : 1)) * resScale; }
function showLeve() {
  const b = document.getElementById('btnLeve');
  if (b) b.textContent = leve ? 'Modo leve: ligado' : 'Modo leve: desligado';
}
function applyQuality(name, keepLeve) {
  qualityName = name;
  if (!keepLeve) leve = name === 'baixa';                 // Baixa liga o modo leve; Media e Alta desligam
  const q = QUALITY[name];
  renderer.setPixelRatio(pixelNow());
  const sh = leve ? 0 : q.shadows;
  renderer.shadowMap.enabled = sh > 0;
  world.setShadowQuality(sh, q.shadowSize);
  world.setLightCount(leve ? 1 : q.lights);
  fx.setLite(leve);
  try { explosives.smokeCount = leve ? 14 : 24; } catch (e) { /* ainda nao criado */ }
  if (character.skin) character.skin.setShadows(sh > 1);
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  resize();
  try { localStorage.setItem('sala_quality', name); localStorage.setItem('sala_leve', leve ? '1' : '0'); } catch (e) { /* ignora */ }
  document.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('on', b.dataset.quality === name));
  showLeve();
}
function setLeve(on) { leve = on; applyQuality(qualityName, true); }
function askLite() {
  let ok = false;
  try { setPaused(true); ok = window.confirm('O jogo está pesado. Ativar o MODO LEVE?'); } catch (e) { /* sem dialogo */ }
  if (ok) { setLeve(true); toast('MODO LEVE LIGADO'); }
}

function applyRes() {
  renderer.setPixelRatio(pixelNow());
  resize();
}
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ------------------------------------------------------------------ personagem e armas
const character = new Character(lib);
scene.add(character.root);
try {
  if (typeof Image !== 'undefined' && !/[?&]procedural/.test(location.search)) character.attachSkin(new SoldadoSkin());
} catch (err) { console.warn('Operador com esqueleto indisponivel, usando o procedural:', err); }
const rigs = {};
for (const id of WEAPON_IDS) rigs[id] = id === 'usp' ? createUSP(lib) : id === 'mp40' ? createMP40(lib) : GUN_BUILDERS[id](lib);
for (const id of WEAPON_IDS) { scene.add(rigs[id].group); rigs[id].group.visible = false; }
const loadout = new Loadout();
loadout.reset();   // comeca so com a pistola; o resto esta espalhado pelo mapa
const pickups = createPickups(scene, lib, world.colliders);
{ // itens fixos nos andares de cima e nas lajes dos sobrados
  const tiers = {
    ground: [['bandage', 'a'], ['ammo', 'short'], ['medkit', 'k'], ['frag', 'f']],
    up: [['ammo', 'long'], ['gel', 'g'], ['weapon', 'mp5'], ['weapon', 'xm8'], ['medkit', 'k']],
    roof: [['weapon', 'awm'], ['weapon', 'scar'], ['scope', '4x'], ['weapon', 'famas'], ['ammo', 'long']],
  };
  const rt = {
    path: [['bandage', 'a'], ['ammo', 'short'], ['medkit', 'k'], ['frag', 'f'], ['ammo', 'long'], ['gel', 'g'], ['bandage', 'a']],
    garage: [['ammo', 'long'], ['medkit', 'k'], ['frag', 'f'], ['gel', 'g'], ['ammo', 'short']],
    garageRare: [['weapon', 'scar'], ['weapon', 'awm'], ['weapon', 'xm8'], ['scope', '4x']],
    hangar: [['ammo', 'long'], ['medkit', 'k'], ['weapon', 'famas'], ['frag', 'f'], ['weapon', 'mp5'], ['ammo', 'short']],
    hangarRare: [['weapon', 'awm'], ['scope', '4x']],
  };
  (scenery.regiaoLoot || []).forEach((l, i) => { const t = rt[l.tier] || rt.path; const [ty, id] = t[i % t.length]; pickups.place(ty, id, l.x, l.z); });
  (scenery.casaLoot || []).forEach((l, i) => { const t = tiers[l.tier]; const [ty, id] = t[(l.house * 3 + i) % t.length]; pickups.place(ty, id, l.x, l.z, l.y); });
}
const stats = new Stats();
const fx = new Effects(scene, lib);
const audio = new GameAudio();
const input = new Input(canvas, {
  joystick: $('joystick'), joyKnob: $('joyKnob'), lookZone: $('lookZone'),
  btnFire: $('btnFire'), btnFire2: $('btnFire2'), btnAim: $('btnAim'),
  btnCrouch: $('btnCrouch'), btnProne: $('btnProne'), btnRun: $('btnRun'), btnJump: $('btnJump'),
  btnHeal: $('btnHeal'), btnFrag: $('btnFrag'), btnGel: $('btnGel'), btnPack: $('btnPack'),
});

// ------------------------------------------------------------------ combate: vida, mochila, bots e explosivos
const vitals = new Vitals();
const pack = new Backpack();
const match = { active: false, time: 600, kills: 0, deaths: 0, dead: false, deadT: 0, mode: 'solo' };
const MATCH_SECONDS = 600;
let lastAttacker = null;
let using = null;        // { kind, t, dur }
let hurtT = 0;
let shakeT = 0;
let fallPeak = 0;
let wasAir = false;
const makeRig = (id) => (id === 'usp' ? createUSP(lib) : id === 'mp40' ? createMP40(lib) : GUN_BUILDERS[id](lib));
function makeGlowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
// altura letal da queda: o ponto mais alto (solido e largo) do mapa
const LETHAL_H = (() => {
  let top = 0;
  for (const c of world.colliders) {
    if (c.circle || c.maxY > 90) continue;
    if (c.maxX - c.minX > 1.2 && c.maxZ - c.minZ > 1.2 && c.maxY > top) top = c.maxY;
  }
  const v = clamp(top, 12, 60);
  console.info('altura mais alta do mapa:', top.toFixed(1), 'm -> queda letal a partir de', v.toFixed(1), 'm');
  return v;
})();

const explosives = new Explosives({
  scene, colliders: world.colliders, fx, audio, glowTex: makeGlowTex(),
  onBlast: (b) => onBlast(b),
  onIce: (col) => onIce(col),
  shake: () => { shakeT = 0.45; },
});
for (const b of world.barrels) {
  explosives.addBarrel({ x: b.x, z: b.z, r: b.r, h: b.h, col: b.col,
    hide() { b.mesh.traverse((o) => o.layers.set(1)); }, show() { b.mesh.traverse((o) => o.layers.set(0)); } });
}
{
  const dm = scenery.getDrumMesh && scenery.getDrumMesh();
  if (dm) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const d of scenery.drums) {
      d.col.noShoot = true;
      const orig = new THREE.Matrix4();
      dm.getMatrixAt(d.idx, orig);
      explosives.addBarrel({ x: d.x, z: d.z, r: d.r, h: d.h, col: d.col,
        hide() { dm.setMatrixAt(d.idx, zero); dm.instanceMatrix.needsUpdate = true; },
        show() { dm.setMatrixAt(d.idx, orig); dm.instanceMatrix.needsUpdate = true; } });
    }
  }
}
const online = new Online({ net: null, scene, makeRig });
const wps = pickups.items.map((it) => ({ x: it.x, z: it.z }));

// ---- barris de FUMACA (azuis, com emblema radioativo): espalhados em lugares livres perto dos pontos de itens (mesma posicao em todos os jogadores)
function makeToxicTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1d5fc4'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#164a9c'; g.fillRect(0, 0, 512, 22); g.fillRect(0, 234, 512, 22);
  g.fillStyle = '#ffd21a'; g.fillRect(0, 22, 512, 6); g.fillRect(0, 228, 512, 6);
  for (const cx of [64, 192, 320, 448]) {
    g.fillStyle = '#ffd21a'; g.beginPath(); g.arc(cx, 128, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, 128, 50, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd21a'; g.beginPath(); g.arc(cx, 128, 47, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    for (let k = 0; k < 3; k++) {                       // simbolo radioativo: 3 pas + miolo
      const a0 = (k * 120 - 90 - 30) * Math.PI / 180, a1 = a0 + Math.PI / 3;
      g.beginPath(); g.moveTo(cx, 128); g.arc(cx, 128, 40, a0, a1); g.closePath(); g.fill();
    }
    g.fillStyle = '#ffd21a'; g.beginPath(); g.arc(cx, 128, 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, 128, 7, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function placeToxicBarrels(count) {
  const free = (x, z) => {
    if (Math.abs(terrainAt(x, z)) > 0.03) return false;            // barril so em chao plano
    for (const c of world.colliders) {
      if (c.minY > 1.2 || c.maxY < 0.1) continue;
      if (x > c.minX - 0.5 && x < c.maxX + 0.5 && z > c.minZ - 0.5 && z < c.maxZ + 0.5) return false;
    }
    return true;
  };
  const pts = wps.slice().sort((a, b) => (a.x - b.x) || (a.z - b.z));
  const out = [];
  const step = Math.max(1, Math.floor(pts.length / (count * 1.5)));
  for (let i = 3; i < pts.length && out.length < count; i += step) {
    for (const [dx, dz] of [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3], [2, 1], [-2, -1]]) {
      const x = pts[i].x + dx, z = pts[i].z + dz;
      if (!free(x, z)) continue;
      if (out.some((q) => Math.hypot(q.x - x, q.z - z) < 12)) continue;
      out.push({ x, z }); break;
    }
  }
  const tex = makeToxicTex();
  const side = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.35, roughness: 0.5 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x164a9c, metalness: 0.5, roughness: 0.45 });
  const geo = new THREE.CylinderGeometry(0.29, 0.29, 0.92, 20);
  for (const p of out) {
    const m = new THREE.Mesh(geo, [side, cap, cap]);
    m.position.set(p.x, 0.46, p.z);
    m.castShadow = true;
    scene.add(m);
    const col = makeCircle(p.x, p.z, 0.3, 0, 0.92);
    col.noShoot = true;
    world.colliders.push(col);
    explosives.addBarrel({ x: p.x, z: p.z, r: 0.3, h: 0.92, col, toxic: true,
      hide() { m.visible = false; }, show() { m.visible = true; } });
  }
}
placeToxicBarrels(5);
const bots = new BotManager({ scene, colliders: world.colliders, makeRig, waypoints: wps, count: COARSE ? 5 : 8 });
bots.onDeath = (b) => { spawnCrate(b.x, b.z, groundHeight(b.x, b.z, b.y || 0, world.colliders), botCrateContents(b), '', false); };

let lastFarShot = 0;
function farShot(id) {            // tiros de bots/outros jogadores: som leve, no maximo 1 a cada 90 ms
  const now = performance.now();
  if (now - lastFarShot < 90) return;
  lastFarShot = now;
  audio.shotLite(WEAPONS[id].kind);
}
function onBlast(b) {
  if (match.active && !match.dead) {
    const d = Math.hypot(player.x - b.x, player.y + 0.9 - b.y, player.z - b.z);
    let dmg = explosionDamage(d, b.radius, b.max);
    if (dmg > 0) {
      const dir = _v1.set(player.x - b.x, player.y + 0.9 - b.y, player.z - b.z);
      const L = dir.length() || 1;
      dir.multiplyScalar(1 / L);
      if (rayBoxes(b.x, b.y, b.z, dir.x, dir.y, dir.z, L, world.colliders) !== Infinity) dmg = Math.round(dmg * 0.4);
      hurtPlayer(dmg);
    }
  }
  if (bots.enabled) {
    const k = bots.blast(b.x, b.y, b.z, b.radius, (dd) => explosionDamage(dd, b.radius, b.max));
    if (k) { match.kills += k; toast('ABATE POR EXPLOSÃO'); }
  }
}
function onIce(col) {
  const push = (e, r) => { const p = { x: e.x, z: e.z }; resolveMovement(p, r, [col], 4, e.y || 0); e.x = p.x; e.z = p.z; };
  push(player, PLAYER_RADIUS + 0.06);
  for (const b of bots.bots) { push(b, 0.4); b.place(b.x, b.y, b.z, b.yaw); }
}
function hurtPlayer(dmg) {
  if (match.dead || !match.active || dmg <= 0) return;
  const died = vitals.damage(dmg * DAMAGE_TAKEN);
  audio.hurt();
  hurtT = 0.6;
  if (died) killPlayer();
}
// ---- caixa de loot: quem morre deixa tudo que carregava
let crateSeq = 0;
function myCrateContents() {
  const guns = [];
  loadout.owned.forEach((o, i) => { if (o) guns.push({ id: WEAPON_IDS[i], mag: loadout.states[i].mag, reserve: loadout.states[i].reserve }); });
  const items = { bandage: pack.n.bandage, medkit: pack.n.medkit, frag: pack.n.frag, gel: pack.n.gel };
  const c = { guns, items, scope4x: !!(pack.scope4x || loadout.has4x) };
  return crateIsEmpty(c) ? null : c;
}
function crateIsEmpty(c) { return !c.guns.length && !c.scope4x && !Object.values(c.items).some((n) => n > 0); }
function cleanCrate(c) {   // dados vindos da rede: valida tudo
  const out = { guns: [], items: { bandage: 0, medkit: 0, frag: 0, gel: 0 }, scope4x: false };
  if (!c || typeof c !== 'object') return out;
  if (Array.isArray(c.guns)) for (const g of c.guns.slice(0, 4)) {
    if (g && WEAPON_IDS.includes(g.id)) out.guns.push({ id: g.id, mag: Math.max(0, Math.min(200, Math.floor(+g.mag) || 0)), reserve: Math.max(0, Math.min(999, Math.floor(+g.reserve) || 0)) });
  }
  for (const k of Object.keys(out.items)) out.items[k] = Math.max(0, Math.min(ITEM_CAP[k], Math.floor(c.items && +c.items[k]) || 0));
  out.scope4x = !!c.scope4x;
  return out;
}
function spawnCrate(x, z, gy, c, cid, send) {
  pickups.dropCrate(x, z, gy, c, cid);
  if (send && online.active) net.send({ t: 'ev', k: 'crate', d: { id: cid, x: Math.round(x * 100) / 100, y: Math.round(gy * 100) / 100, z: Math.round(z * 100) / 100, c } });
}
function botCrateContents(b) {
  const id = WEAPONS[b.weaponId] ? b.weaponId : 'mp5';
  const cfg = WEAPONS[id];
  const items = { bandage: Math.random() < 0.6 ? 1 : 0, medkit: Math.random() < 0.3 ? 1 : 0, frag: Math.random() < 0.4 ? 1 : 0, gel: Math.random() < 0.2 ? 1 : 0 };
  return { guns: [{ id, mag: cfg.magSize, reserve: Math.round(cfg.reserve * 0.5) }], items, scope4x: false };
}
// ---- pre-visualizacao do loot (sem botoes): toque no icone (ou tecla E) para pegar/trocar; andar para longe = nao pegar
const icons = createIcons(renderer, (t, i) => pickups.visual(t, i));
const ammoEl = $('ammo');
const lootEl = $('lootPanel') || (() => { const d = document.createElement('div'); d.id = 'lootPanel'; document.body.appendChild(d); return d; })();
{
  const st = document.createElement('style');
  st.textContent = `
  .layer { z-index:4; }   /* o HUD fica acima da area de camera (lookZone): sem isso os toques nos quadros de arma e loot nao chegam */
  #ammo.wnew { background:none !important; border:none !important; padding:0 !important; min-width:0 !important; backdrop-filter:none; text-align:left; width:132px; }
  body.touch #itemBtns { top:calc(152px + env(safe-area-inset-top)); gap:6px; }
  body.touch .ib { width:calc(var(--Bt)*.86); height:calc(var(--Bt)*.86); }
  #ammo.wnew > #wName, #ammo.wnew > #ammoLine, #ammo.wnew > .rbar, #ammo.wnew > .slots { display:none; }
  #wCards { display:flex; flex-direction:column; gap:3px; width:132px; font-family:inherit; }
  .wBig, .wSm { position:relative; background:rgba(24,30,42,.8); border-radius:4px; color:#fff; overflow:hidden; }
  .wBig { height:46px; display:flex; align-items:center; padding:3px 6px 7px; gap:4px; }
  .wBig .wn { flex:0 0 auto; font-size:20px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }
  .wBig .wn small { font-size:10px; color:#c8d0dc; font-weight:400; }
  .wBig .wn.low { color:#ff6a58; }
  .wBig .wi { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; }
  .wBig img { width:62px; height:30px; object-fit:contain; }
  .wRow { display:flex; gap:3px; }
  .wSm { flex:1; height:44px; display:flex; flex-direction:column; align-items:center; padding:3px 3px 8px; cursor:pointer; pointer-events:auto; }
  .wSm img { width:34px; height:19px; object-fit:contain; pointer-events:none; }
  .wSm .wn { font-size:9px; font-weight:700; font-variant-numeric:tabular-nums; position:absolute; left:5px; bottom:6px; pointer-events:none; }
  .wSm.empty { opacity:.45; cursor:default; } .wSm.inf { font-size:18px; align-items:center; justify-content:center; padding:0; cursor:default; }
  .wt { font-size:6.5px; letter-spacing:.05em; color:#dfe5ee; text-transform:uppercase; line-height:1; margin-top:1px; pointer-events:none; }
  .wBar { position:absolute; left:5px; right:5px; bottom:2.5px; height:2px; background:rgba(255,255,255,.22); } .wBar i { display:block; height:100%; width:100%; background:#fff; transform-origin:left; }
  .wBar.low i { background:#ff6a58; }
  .wBig { cursor:pointer; pointer-events:auto; }
  .wBig.off { opacity:.55; }
  #lootPanel { position:fixed; z-index:6; display:none; flex-direction:column; gap:3px; width:150px; padding:4px; background:rgba(14,18,26,.72); border-radius:6px; pointer-events:auto; touch-action:none; user-select:none; -webkit-user-select:none; }
  #lootPanel .lh { font-size:7.5px; letter-spacing:.08em; color:#aab4c2; text-align:center; pointer-events:none; }
  .lp { display:flex; align-items:center; gap:6px; color:#fff; cursor:pointer; padding:1px 2px; border-radius:4px; }
  .lp:active { background:rgba(255,255,255,.18); }
  .lp .lpi { width:44px; height:30px; object-fit:contain; flex:0 0 auto; pointer-events:none; }
  .lp .lt { display:flex; flex-direction:column; min-width:0; pointer-events:none; }
  .lp b { font-size:10px; letter-spacing:.03em; line-height:1.1; }
  .lp i { font-size:9px; font-style:normal; color:#ffd23a; display:flex; align-items:center; gap:2px; }
  .lp .lps { width:22px; height:15px; object-fit:contain; }`;
  (document.head || document.documentElement).appendChild(st);
}
let lootEntries = [];
let lootSig = '';
const ICON_WARM = [['weapon', 'usp', 1], ['weapon', 'mp40', 1], ['weapon', 'g18', 1], ['weapon', 'mp5', 1], ['weapon', 'xm8', 1], ['weapon', 'famas', 1], ['weapon', 'scar', 1], ['weapon', 'awm', 1],
  ['weapon', 'usp'], ['weapon', 'mp40'], ['weapon', 'g18'], ['weapon', 'mp5'], ['weapon', 'xm8'], ['weapon', 'famas'], ['weapon', 'scar'], ['weapon', 'awm'], ['scope', '4x'], ['ammo', 'short'], ['ammo', 'long'], ['bandage', 'a'], ['medkit', 'k'], ['frag', 'f'], ['gel', 'g']];
const ITEM_LABEL = { bandage: 'ATADURA', medkit: 'KIT MÉDICO', frag: 'GRANADA', gel: 'GEL' };
function itemLabel(type, id) {
  if (type === 'weapon') return WEAPONS[id] ? WEAPONS[id].name : id;
  if (type === 'ammo') return id === 'long' ? 'MUNIÇÃO LONGA' : 'MUNIÇÃO CURTA';
  if (type === 'scope') return 'MIRA 4x';
  return ITEM_LABEL[type] || type;
}
function lootNearby() {
  const out = [];
  for (const it of pickups.nearby(player.x, player.z, player.y, state.time, 3)) {
    if (it.type === 'crate' && it.contents) {
      for (const g of it.contents.guns) out.push({ k: 'cgun', it, g });
      for (const kind of ['bandage', 'medkit', 'frag', 'gel']) if (it.contents.items[kind] > 0) out.push({ k: 'citem', it, kind, n: it.contents.items[kind] });
      if (it.contents.scope4x) out.push({ k: 'cscope', it });
    } else out.push({ k: 'item', it });
  }
  return out.slice(0, 5);
}
/** Descricao de uma entrada: icone, nome, quantidade e (se for arma) o que seria trocado. */
function describeEntry(e) {
  if (e.k === 'item') {
    const t = e.it.type, id = e.it.id;
    const d = { type: t, id, name: itemLabel(t, id), sub: '' };
    if (t === 'weapon') {
      const idx = WEAPON_IDS.indexOf(id), dr = loadout.wouldDrop(idx);
      if (dr === null) d.sub = '+ MUNIÇÃO'; else if (dr >= 0) { d.swap = WEAPON_IDS[dr]; d.sub = 'TROCA'; } else d.sub = 'NOVA';
    }
    return d;
  }
  if (e.k === 'cgun') {
    const idx = WEAPON_IDS.indexOf(e.g.id), dr = loadout.wouldDrop(idx);
    const d = { type: 'weapon', id: e.g.id, name: itemLabel('weapon', e.g.id), sub: e.g.mag + '/' + e.g.reserve };
    if (dr === null) d.sub = '+ MUNIÇÃO'; else if (dr >= 0) { d.swap = WEAPON_IDS[dr]; d.sub = 'TROCA ' + e.g.mag + '/' + e.g.reserve; }
    return d;
  }
  if (e.k === 'citem') return { type: e.kind, id: 'x', name: ITEM_LABEL[e.kind], sub: '×' + e.n };
  return { type: 'scope', id: '4x', name: 'MIRA 4x', sub: '' };
}
let lootPlaceT = 0;
function placeLoot() {      // fica no canto direito, logo abaixo do quadro de armas
  const r = ammoEl.getBoundingClientRect();
  lootEl.style.right = Math.round(window.innerWidth - r.right + (input.touch ? 66 : 0)) + 'px';
  lootEl.style.left = 'auto';
  if (input.touch) { lootEl.style.top = Math.round(r.bottom + 6) + 'px'; lootEl.style.bottom = 'auto'; }      // celular: abaixo do quadro de armas
  else { lootEl.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px'; lootEl.style.top = 'auto'; }    // PC: o quadro fica embaixo, entao o painel sobe
}
function updateLootPanel(dead) {
  if (state.started && !state.paused) { try { icons.warm(ICON_WARM); } catch (e) { /* sem icones: so texto */ } }
  lootEntries = dead || state.paused || !state.started ? [] : lootNearby();
  try {
    let sig = '';
    const ds = lootEntries.map((e) => { const d = describeEntry(e); sig += d.type + d.id + d.name + d.sub + (d.swap || '') + '|'; return d; });
    if (sig !== lootSig) {
      lootSig = sig;
      if (!ds.length) { lootEl.style.display = 'none'; lootEl.textContent = ''; }
      else {
        const img = (t, i, cls) => { const u = icons.url(t, i); return u ? '<img class="' + cls + '" src="' + u + '">' : ''; };
        lootEl.innerHTML = '<div class="lh">' + (input.touch ? 'TOQUE PARA PEGAR' : 'CLIQUE OU TECLA E') + '</div>' + ds.map((d, n) => '<div class="lp" data-i="' + n + '">' + img(d.type, d.id, 'lpi') + '<div class="lt"><b>' + d.name + '</b>' +
          (d.sub ? '<i>' + (d.swap ? '⇄ ' + img('weapon', d.swap, 'lps') : '') + d.sub + '</i>' : '') + '</div></div>').join('');
        lootEl.style.display = 'flex';
        placeLoot();
      }
    }
    if (ds.length && ++lootPlaceT % 30 === 0) placeLoot();
  } catch (err) { console.warn('painel de loot:', err); }
}
lootEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  const t = e.target.closest ? e.target.closest('.lp') : null;
  if (t) { const en = lootEntries[+t.dataset.i]; if (en) takeLoot(en); }
});

// ---- quadro de armas e municao (estilo "arma em uso grande + 2 reservas"): desenho branco, nome pequeno, barra e numero de municao
const wcEl = document.createElement('div');
wcEl.id = 'wCards';
ammoEl.classList.add('wnew');
ammoEl.appendChild(wcEl);
wcEl.innerHTML = '<div class="wBig"><div class="wn"><span class="wm">0</span><small class="wr"></small></div><div class="wi"><img class="wimg"><div class="wt wname"></div></div><div class="wBar big"><i></i></div></div>' +
  '<div class="wRow">' + [0, 1].map((k) => '<div class="wSm" data-k="' + k + '"><img class="wimg"><div class="wt wname"></div><div class="wn"></div><div class="wBar"><i></i></div></div>').join('') + '<div class="wSm inf">∞</div></div>';
const wBig = wcEl.querySelector('.wBig');
const wSm = [...wcEl.querySelectorAll('.wSm[data-k]')];
wBig.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.actions.push('reload'); });
let slotOrder = [];      // [em uso, reserva 1, reserva 2]: tocar numa reserva troca de lugar com a arma em uso
wSm.forEach((el) => el.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  const idx = slotOrder[1 + +el.dataset.k];
  if (idx !== undefined && loadout.owned[idx]) input.actions.push('w' + (idx + 1));
}));
function setWeaponImg(el, id, key) {
  if (el._k === key) return;
  el._k = key;
  const u = id ? icons.url('weapon', id, true) : '';
  el.style.visibility = u ? 'visible' : 'hidden';
  if (u) el.src = u;
}
function updateWeaponHud() {
  slotOrder = slotOrder.filter((i) => loadout.owned[i]);
  loadout.owned.forEach((o, i) => { if (o && !slotOrder.includes(i)) slotOrder.push(i); });
  if (state.armed) { const p = slotOrder.indexOf(loadout.index); if (p > 0) { const t = slotOrder[0]; slotOrder[0] = slotOrder[p]; slotOrder[p] = t; } }
  const bi = slotOrder[0];
  const w = bi === undefined ? null : loadout.states[bi];
  setClass('wb', wBig, 'off', !state.armed);
  setText('wbm', wBig.querySelector('.wm'), w ? String(w.mag).padStart(2, '0') : '--');
  setText('wbr', wBig.querySelector('.wr'), w ? '/' + w.reserve : '');
  setClass('wbl', wBig.querySelector('.wn'), 'low', !!w && w.mag <= Math.ceil(w.cfg.magSize * 0.25));
  setText('wbn', wBig.querySelector('.wname'), w ? w.cfg.name : 'SEM ARMA');
  setWeaponImg(wBig.querySelector('.wimg'), w ? WEAPON_IDS[bi] : null, 'b' + bi);
  const frac = w ? (w.reloading ? w.reloadProgress : w.mag / w.cfg.magSize) : 0;
  const bf = Math.round(frac * 50) / 50;
  if (hudCache.wbf !== bf) { hudCache.wbf = bf; wBig.querySelector('.wBar i').style.transform = `scaleX(${bf})`; }
  setClass('wbb', wBig.querySelector('.wBar'), 'low', !!w && !w.reloading && w.mag <= Math.ceil(w.cfg.magSize * 0.25));
  wSm.forEach((el, k) => {
    const i = slotOrder[1 + k];
    const s = i === undefined ? null : loadout.states[i];
    setClass('wse' + k, el, 'empty', !s);
    setText('wsn' + k, el.querySelector('.wname'), s ? s.cfg.name : '');
    setText('wst' + k, el.querySelector('.wn'), s ? String(s.mag + s.reserve) : '');
    setWeaponImg(el.querySelector('.wimg'), s ? WEAPON_IDS[i] : null, 's' + i);
    const f = s ? Math.round(Math.min(1, (s.mag + s.reserve) / (s.cfg.magSize + s.cfg.reserve)) * 50) / 50 : 0;
    if (hudCache['wsf' + k] !== f) { hudCache['wsf' + k] = f; el.querySelector('.wBar i').style.transform = `scaleX(${f})`; }
  });
}
/** Entrega um item solto do mapa. Retorna true se foi consumido. */
function giveItem(type, id) {
  if (type === 'bandage' || type === 'medkit' || type === 'frag' || type === 'gel') {
    if (pack.add(type, 1) > 0) { audio.pickup(); toast('+ ' + ITEM_NAMES[type].toUpperCase()); return true; }
    toast('MOCHILA CHEIA'); return false;
  }
  if (type === 'ammo') {
    const got = loadout.addAmmo(id);
    if (got > 0) { audio.pickup(); toast(id === 'long' ? '+ MUNIÇÃO LONGA (fuzis e AWM)' : '+ MUNIÇÃO CURTA (pistolas e SMG)'); return true; }
    toast('MUNIÇÃO CHEIA'); return false;
  }
  if (type === 'scope') {
    if (loadout.has4x) { toast('VOCÊ JÁ TEM A MIRA 4x'); return false; }
    loadout.has4x = true; pack.scope4x = true; audio.pickup(); toast('MIRA 4x PEGA — vale só para FAMAS e SCAR'); return true;
  }
  const idx = WEAPON_IDS.indexOf(id);
  if (idx < 0) return false;
  const nm = WEAPONS[id].name;
  if (loadout.owned[idx]) {
    const got = loadout.addAmmo(id);
    if (got > 0) { audio.pickup(); toast('+ MUNIÇÃO ' + nm); return true; }
    toast('MUNIÇÃO CHEIA'); return false;
  }
  const pr = loadout.pickUp(idx);
  if (pr && pr.dropped >= 0) { dropItem('weapon', WEAPON_IDS[pr.dropped]); toast(WEAPONS[WEAPON_IDS[pr.dropped]].name + ' LARGADA'); }
  audio.pickup();
  switchWeapon(idx);
  toast(nm + ' PEGA!  (tecla ' + (idx + 1) + ')');
  return true;
}
function crateDone(it) {
  if (!crateIsEmpty(it.contents)) return;
  if (it.cid && online.active) net.send({ t: 'ev', k: 'cget', d: { id: it.cid } });
  pickups.remove(it);
}
/** Pega UMA coisa da pre-visualizacao. */
function takeLoot(e) {
  if (match.dead || !e || !e.it.active) return false;
  const it = e.it;
  if (e.k === 'item') { if (giveItem(it.type, it.id)) { pickups.remove(it); return true; } return false; }
  const c = it.contents;
  if (!c) return false;
  if (e.k === 'cgun') {
    const g = e.g, idx = WEAPON_IDS.indexOf(g.id);
    if (idx < 0) { c.guns.splice(c.guns.indexOf(g), 1); return false; }
    if (loadout.owned[idx]) {
      if (loadout.addAmmo(g.id) <= 0) { toast('MUNIÇÃO CHEIA'); return false; }
      audio.pickup(); toast('+ MUNIÇÃO ' + WEAPONS[g.id].name);
    } else {
      const pr = loadout.pickUp(idx);
      loadout.states[idx].mag = g.mag; loadout.states[idx].reserve = g.reserve;
      if (pr && pr.dropped >= 0) { dropItem('weapon', WEAPON_IDS[pr.dropped]); toast(WEAPONS[WEAPON_IDS[pr.dropped]].name + ' LARGADA'); }
      audio.pickup(); switchWeapon(idx); toast(WEAPONS[g.id].name + ' PEGA!');
    }
    c.guns.splice(c.guns.indexOf(g), 1);
  } else if (e.k === 'citem') {
    const got = pack.add(e.kind, c.items[e.kind]);
    if (got <= 0) { toast('MOCHILA CHEIA'); return false; }
    c.items[e.kind] -= got; audio.pickup(); toast('+ ' + got + ' ' + ITEM_NAMES[e.kind].toUpperCase());
  } else if (e.k === 'cscope') {
    if (loadout.has4x) { toast('VOCÊ JÁ TEM A MIRA 4x'); return false; }
    loadout.has4x = true; pack.scope4x = true; c.scope4x = false; audio.pickup(); toast('MIRA 4x PEGA');
  }
  crateDone(it);
  lootSig = '';
  return true;
}
function killPlayer() {
  { const c = myCrateContents(); if (c) spawnCrate(player.x, player.z, groundHeight(player.x, player.z, player.y, world.colliders), c, online.you + ':' + (++crateSeq) + ':' + Math.floor(Math.random() * 1e6), true); }
  if (drop.phase) endDrop();
  match.dead = true; match.deadT = 4; match.deaths++;
  using = null; { const ur = $('useRing'); if (ur) ur.className = ''; } state.gelMode = false; input.fire = false; input.aim = false;
  $('dead').classList.add('on');
  if (online.active) net.send({ t: 'dead', by: lastAttacker });
}
function respawnPlayer() {
  const w = wps[Math.floor(Math.random() * wps.length)];
  player.x = w.x; player.z = w.z; player.y = groundHeight(w.x, w.z, 0, world.colliders); player.vx = player.vz = player.vy = 0;
  vitals.reset(); pack.reset(); loadout.reset(); state.armed = true;
  prevWeaponIndex = -1; syncWeaponVisual();
  match.dead = false; fallPeak = 0; wasAir = false;
  $('dead').classList.remove('on');
}

// ------------------------------------------------------------------ estado
const player = { x: SPAWN.x, z: SPAWN.z, y: 0, vy: 0, vx: 0, vz: 0, speed: 0, hipsYaw: SPAWN.yaw };
const view = { yaw: SPAWN.yaw, pitch: 0.0, recoil: 0 };
const state = {
  running: false, paused: true, started: false,
  aimBlend: 0, slide: 0, recoilVis: 0, camDist: 2.6, fireHold: 0, wallPull: 0,
  crouch: false, crouchK: 0, prone: false, proneK: 0, handKind: 'gel', alignK: 1, grounded: true, airK: 0,
  time: 0, lastStep: 0,
  armed: true, startArmed: true, outdoor: 0, gelMode: false,
};
let prevWeaponIndex = -1;

// ------------------------------------------------------------------ queda de helicoptero (inicio da partida)
const drop = { phase: null, ht: 0, d: null };      // phase: 'heli' | 'fall' | 'chute' | null
const heli = createHeli(scene);
const playerChute = createChute(); scene.add(playerChute);
const dropBtn = document.createElement('div');
dropBtn.id = 'btnDrop';
dropBtn.style.cssText = 'position:fixed;z-index:6;right:calc(24px + env(safe-area-inset-right));bottom:34%;min-width:112px;padding:18px 14px;border-radius:18px;background:rgba(210,102,31,.92);color:#fff;font:700 17px system-ui,sans-serif;text-align:center;letter-spacing:.5px;box-shadow:0 2px 12px rgba(0,0,0,.5);display:none;touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer';
document.body.appendChild(dropBtn);
dropBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.actions.push('dropbtn'); });
const FOG0 = { near: scene.fog.near, far: scene.fog.far };
function showDropBtn() {
  const t = drop.phase === 'heli' ? 'PULAR' : drop.phase === 'fall' ? 'ABRIR PARAQUEDAS' : '';
  dropBtn.style.display = t ? 'block' : 'none'; dropBtn.textContent = t;
}
function beginDrop() {
  drop.phase = 'heli'; drop.ht = 0; drop.d = null;
  heli.show(true); heli.setInside(true);
  view.yaw = -Math.PI / 2; view.pitch = -0.5;
  scene.fog.near = 380; scene.fog.far = 1300;
  character.root.visible = false; playerChute.visible = false;
  if (bots.enabled) bots.dropStart();
  showDropBtn();
}
function endDrop(hideHeli = true) {
  drop.phase = null; drop.d = null;
  scene.fog.near = FOG0.near; scene.fog.far = FOG0.far;
  character.root.visible = true; playerChute.visible = false;
  if (hideHeli) heli.show(false);
  showDropBtn();
  if (camera.fov !== TP_FOV) { camera.fov = TP_FOV; camera.updateProjectionMatrix(); }
}
function dropAction() {
  if (drop.phase === 'heli') {
    drop.phase = 'fall';
    drop.d = newDrop(player.x, player.y, player.z);
    heli.setInside(false); character.root.visible = true;
    view.pitch = 0.1;
    audio.jump();
  } else if (drop.phase === 'fall') {
    if (openChute(drop.d, false)) { drop.phase = 'chute'; audio.pickup(); }
  }
  showDropBtn();
}

const raycaster = new THREE.Raycaster();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _mv = { x: 0, y: 0 };
const _lk = { x: 0, y: 0 };
const _normal = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _nm = new THREE.Matrix3();

function forwardFrom(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

// ------------------------------------------------------------------ HUD
const hud = {
  weaponName: $('wName'), mag: $('ammoMag'), reserve: $('ammoReserve'), reloadBar: $('reloadBar'),
  reloadHint: $('reloadHint'), score: $('score'), hits: $('hits'), shots: $('shots'), acc: $('acc'),
  cross: $('crosshair'), hit: $('hitmarker'), toast: $('toast'),
};
let toastT = 0;
let hitT = 0;
function toast(text) {
  hud.toast.textContent = text;
  hud.toast.classList.add('show');
  toastT = 1.1;
}
const slotEls = WEAPON_IDS.map((id, i) => {
  const d = document.createElement('div');
  d.className = 'slot';
  d.textContent = (i + 1) + ' ' + WEAPONS[id].name;
  $('slots').appendChild(d);
  return d;
});
const handsSlot = document.createElement('div');
handsSlot.className = 'slot';
handsSlot.textContent = 'H MÃOS';
$('slots').appendChild(handsSlot);
// tocar/clicar no nome da arma escolhe ela (qualquer arma que ja esta na mochila) ; MAOS guarda a arma
slotEls.forEach((d, i) => {
  const pick = (e) => { e.preventDefault(); e.stopPropagation(); if (loadout.owned[i]) input.actions.push('w' + (i + 1)); };
  d.addEventListener('pointerdown', pick);
});
handsSlot.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); input.actions.push('hands'); });
const hudCache = {};
function setText(key, el, v) { if (hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }
function setClass(key, el, cls, on) { const k = key + cls; if (hudCache[k] !== on) { hudCache[k] = on; el.classList.toggle(cls, on); } }
function updateHud() {
  updateWeaponHud();
  const w = loadout.current;
  const armed = state.armed;
  const lbl = w.cfg.scope4 && loadout.has4x ? w.cfg.label.replace('2x', '4x') : w.cfg.label;
  setText('wn', hud.weaponName, armed ? lbl : 'MÃOS LIVRES');
  setText('mag', hud.mag, armed ? String(w.mag).padStart(2, '0') : '--');
  setText('res', hud.reserve, armed ? '/ ' + w.reserve : '');
  setClass('mag', hud.mag, 'low', armed && w.mag <= Math.ceil(w.cfg.magSize * 0.25));
  const rp = Math.round(w.reloadProgress * 50) / 50;
  if (hudCache.rp !== rp) { hudCache.rp = rp; hud.reloadBar.style.transform = `scaleX(${rp})`; }
  setClass('rb', hud.reloadBar.parentElement, 'on', w.reloading);
  const noAmmo = w.mag === 0 && w.reserve === 0;
  setText('hint', hud.reloadHint, noAmmo ? 'SEM MUNIÇÃO — ACHE UMA CAIXA' : 'RECARREGAR (R)');
  setClass('hint', hud.reloadHint, 'on', armed && !w.reloading && w.mag === 0);
  setText('sc', hud.score, String(stats.score));
  setText('hi', hud.hits, String(stats.hits));
  setText('sh', hud.shots, String(stats.shots));
  setText('ac', hud.acc, stats.accuracy.toFixed(1) + '%');
  for (let i = 0; i < slotEls.length; i++) {
    setClass('s' + i, slotEls[i], 'on', armed && loadout.index === i);
    setClass('sl' + i, slotEls[i], 'lock', !loadout.owned[i]);
  }
  setClass('sh', handsSlot, 'on', !armed);
}

// ------------------------------------------------------------------ armas: troca e visibilidade
let prevArmed = null;
function syncWeaponVisual() {
  if (prevWeaponIndex === loadout.index && prevArmed === state.armed) return;
  prevWeaponIndex = loadout.index;
  prevArmed = state.armed;
  const id = loadout.currentId;
  for (const k of WEAPON_IDS) rigs[k].group.visible = state.armed && k === id;
  fx.attachMuzzle(rigs[id].muzzle, rigs[id].flashScale);
}

function switchWeapon(i) {
  if (!state.armed) {            // sacar a arma escolhida estando de maos livres
    if (!loadout.owned[i]) return;
    state.armed = true;
    if (i !== loadout.index) loadout.switchTo(i); else loadout.current.drawT = loadout.current.cfg.drawTime;
    audio.draw();
    state.slide = 0;
    syncWeaponVisual();
    return;
  }
  if (loadout.switchTo(i)) {
    audio.draw();
    state.slide = 0;
    syncWeaponVisual();
  }
}

function holster() {
  if (!state.armed) return;
  loadout.current.cancelReload();
  state.armed = false;
  input.aim = false;
  syncWeaponVisual();
}

// botao de trocar: pistola -> MP40 (se tiver) -> maos livres -> pistola
function cycleWeapon() {
  if (!state.armed) { const f = loadout.owned.indexOf(true); switchWeapon(f >= 0 ? f : loadout.index); return; }   // de maos livres volta para a primeira arma da mochila
  const next = loadout.nextOwned();
  if (next > loadout.index) switchWeapon(next);
  else holster();
}

// ------------------------------------------------------------------ disparo
function shoot() {
  const id = loadout.currentId;
  const rig = rigs[id];
  const cfg = WEAPONS[id];

  // direcao de visao (centro da mira) e origem da camera
  const f = forwardFrom(view.yaw, view.pitch + view.recoil, _fwd);
  character.eyePosition(_eye, view.yaw);

  // dispersao
  const ads = state.aimBlend > 0.5;
  let spread = ads ? cfg.spreadAim : cfg.spreadHip;
  if (player.speed > 0.5) spread *= 1.0 + Math.min(1, player.speed / RUN) * 0.8;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * spread;
  _rgt.set(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
  _v1.crossVectors(_rgt, f).normalize(); // "cima" local da visao
  const dir = _v2.copy(f).addScaledVector(_rgt, Math.cos(a) * r).addScaledVector(_v1, Math.sin(a) * r).normalize();

  // origem do raio de mira: camera; ignora geometria atras do jogador
  const camPos = camera.getWorldPosition(_cam);
  const tStart = Math.max(0, _v3.subVectors(_eye, camPos).dot(dir));
  const origin = _v3.copy(camPos).addScaledVector(dir, tStart);
  raycaster.set(origin, dir);
  raycaster.near = 0;
  raycaster.far = cfg.range;

  const hits = raycaster.intersectObjects(shootables, false);
  let hit = hits.length ? hits[0] : null;
  // parede/estrutura de ferro/gelo/qualquer colisor: a bala NUNCA atravessa (vale o que estiver mais perto)
  let wallHit = rayShot(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, cfg.range, world.colliders);
  if (wallHit && hit && hit.distance <= wallHit.t + 0.02) wallHit = null;          // o objeto visivel esta na frente
  else if (wallHit) hit = null;                                                     // colisor na frente do que a malha mostra

  // ponto-alvo: o que o centro da mira enxerga
  if (wallHit) _end.copy(origin).addScaledVector(dir, wallHit.t);
  else if (hit) _end.copy(hit.point); else _end.copy(origin).addScaledVector(dir, Math.min(cfg.range, 90));

  // alvos vivos: bots e barris
  let special = null;
  {
    const maxD = wallHit ? wallHit.t : hit ? hit.distance : cfg.range;
    const bh = bots.rayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxD);
    const br = explosives.rayBarrel(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxD);
    const rh = online.active ? online.rayHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxD) : null;
    const nearest = Math.min(bh ? bh.t : 1e9, br ? br.t : 1e9, rh ? rh.t : 1e9);
    if (rh && rh.t <= nearest) special = { kind: 'remote', t: rh.t, rh };
    else if (bh && (!br || bh.t <= br.t)) special = { kind: 'bot', t: bh.t, bh };
    else if (br) special = { kind: 'barrel', t: br.t, br };
    if (special) { _end.copy(origin).addScaledVector(dir, special.t); hit = null; wallHit = null; }
  }

  // o projetil sai da boca do cano: nada pode estar no caminho (arma encostada na parede)
  rig.muzzle.getWorldPosition(_muzzle);
  _v1.subVectors(_end, _muzzle);
  const dist = _v1.length();
  if (dist > 0.02) {
    _v1.multiplyScalar(1 / dist);
    raycaster.set(_muzzle, _v1);
    raycaster.far = dist - 0.01;
    const block = raycaster.intersectObjects(occluders, false);
    if (block.length) { hit = block[0]; wallHit = null; _end.copy(hit.point); special = null; }
    else {
      const wb = rayShot(_muzzle.x, _muzzle.y, _muzzle.z, _v1.x, _v1.y, _v1.z, dist - 0.01, world.colliders);
      if (wb && wb.t > 0.05) { wallHit = wb; hit = null; special = null; _end.copy(_muzzle).addScaledVector(_v1, wb.t); }
    }
  }

  stats.registerShot();
  if (online.active) net.send({ t: 'ev', k: 'shot', d: { a: [_muzzle.x, _muzzle.y, _muzzle.z], b: [_end.x, _end.y, _end.z], w: id } });
  fx.fire(_muzzle, _end);
  audio.shot(id, cfg.kind);

  if (special && special.kind === 'bot') {
    const { bot, zone } = special.bh;
    const killed = bots.damage(bot, cfg.dmg, zone);
    stats.registerHit(zone === 'cabeca' ? 100 : 50, zone);
    audio.impact('paper');
    hud.hit.classList.add('on'); hitT = 0.14;
    if (killed) { match.kills++; toast('INIMIGO ABATIDO'); } else toast(zone.toUpperCase());
  } else if (special && special.kind === 'remote') {
    const { id, zone } = special.rh;
    net.send({ t: 'hit', to: id, dmg: shotDamage(cfg.dmg, zone) });
    stats.registerHit(zone === 'cabeca' ? 100 : 50, zone);
    audio.impact('paper');
    hud.hit.classList.add('on'); hitT = 0.14;
    toast(zone.toUpperCase());
  } else if (special && special.kind === 'barrel') {
    const dmB = shotDamage(cfg.dmg, 'corpo');
    explosives.damageBarrel(special.br.barrel, dmB, 'player');
    if (online.active) net.send({ t: 'ev', k: 'bdmg', d: { i: explosives.barrels.indexOf(special.br.barrel), dm: dmB } });
    audio.impact('plate');
    toast('BARRIL ACESO — AFASTE-SE!');
  }
  if (wallHit) {
    const b = wallHit.box;
    if (b.iceWall) { explosives.damageWall(b.iceWall, cfg.dmg); audio.impact('plate'); }
    else audio.impact('wall');
    // normal da face atingida (para a marca do tiro)
    const ex = _end.x, ey = _end.y, ez = _end.z;
    if (b.circle) { _normal.set(ex - b.x, 0, ez - b.z).normalize(); }
    else {
      const d = [Math.abs(ex - b.minX), Math.abs(ex - b.maxX), Math.abs(ey - b.minY), Math.abs(ey - b.maxY), Math.abs(ez - b.minZ), Math.abs(ez - b.maxZ)];
      let k = 0; for (let i = 1; i < 6; i++) if (d[i] < d[k]) k = i;
      _normal.set(k === 0 ? -1 : k === 1 ? 1 : 0, k === 2 ? -1 : k === 3 ? 1 : 0, k === 4 ? -1 : k === 5 ? 1 : 0);
    }
    fx.impact(_end, _normal, scene, b.iceWall ? 0.05 : 0.07, true);
  }
  if (hit && hit.face) {
    _normal.copy(hit.face.normal);
    _nm.getNormalMatrix(hit.object.matrixWorld);
    _normal.applyMatrix3(_nm).normalize();
    if (_normal.dot(dir) > 0) _normal.negate();
    const target = hit.object.userData.target;
    if (target && !target.isDown) {
      const res = target.evaluate(hit.point);
      stats.registerHit(res.points, res.zone);
      const felled = target.onHit(cfg.damage, res.zone);
      fx.impact(hit.point, _normal, hit.object, target.kind === 'plate' ? 0.045 : 0.05, target.kind === 'plate');
      audio.impact(target.kind === 'plate' ? 'plate' : 'paper');
      hud.hit.classList.add('on');
      hitT = 0.14;
      toast(felled ? `CABEÇA  +${res.points}  •  ALVO ABATIDO` : `${res.zone.toUpperCase()}  +${res.points}`);
    } else if (hit.object.userData.ice) {
      explosives.damageWall(hit.object.userData.ice, cfg.dmg);
      fx.impact(hit.point, _normal, hit.object, 0.05, true);
      audio.impact('plate');
    } else {
      fx.impact(hit.point, _normal, hit.object, 0.07, true);
      audio.impact('wall');
    }
  }

  // recuo: a mira sobe e a arma/tronco reagem
  view.recoil += cfg.recoilPitch * (1 + (Math.random() - 0.5) * 0.3);
  view.yaw += (Math.random() - 0.5) * cfg.recoilPitch * 0.5;
  state.recoilVis = Math.min(1, state.recoilVis + cfg.recoilKick);
  state.slide = 1;
  state.fireHold = 0.6;
}

// ------------------------------------------------------------------ restart / pausa
function restart() {
  state.gelMode = false;
  vitals.reset(); pack.reset(); using = null; explosives.reset();
  match.time = MATCH_SECONDS; match.kills = 0; match.deaths = 0; match.dead = false; fallPeak = 0; wasAir = false;
  $('dead').classList.remove('on');
  if (bots.enabled) bots.start(player);
  stats.reset();
  loadout.reset();
  state.armed = state.startArmed;
  pickups.reset();
  prevWeaponIndex = -1;
  syncWeaponVisual();
  world.resetTargets();
  fx.clearDecals();
  player.x = SPAWN.x; player.z = SPAWN.z; player.y = 0; player.vy = 0; player.vx = 0; player.vz = 0; player.speed = 0;
  player.hipsYaw = SPAWN.yaw;
  view.yaw = SPAWN.yaw; view.pitch = 0; view.recoil = 0;
  state.aimBlend = 0; state.slide = 0; state.recoilVis = 0;
  state.crouch = false; state.crouchK = 0; state.prone = false; state.proneK = 0; state.alignK = 1; state.grounded = true; state.airK = 0; input.runToggle = false; $('btnRun').classList.remove('on');
  audio.restart();
  beginDrop();
  toast('PARTIDA REINICIADA');
  updateHud();
}

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } },
};
const SCREENS = ['lobby', 'friends', 'chars', 'settings', 'pause', 'account', 'pack', 'results'];
function showScreen(id) {
  for (const n of SCREENS) $(n).classList.toggle('show', n === id);
  document.body.classList.toggle('lobbyMode', !state.started);
  document.body.classList.toggle('playing', state.started && !state.paused);
}
let settingsFrom = 'lobby';

function setPaused(p) {
  if (state.paused === p) return;
  state.paused = p;
  showScreen(p && state.started ? 'pause' : null);
  if (p) { input.releaseAll(); input.exitLock(); } else { input.requestLock(); }
  input.enabled = !p;
}

// ---- tela cheia (so joga em tela cheia, quando o aparelho permite)
let fsPref = store.get('sala_fs', '1') !== '0';
let fsWorks = false;
function enterFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenEnabled || !el.requestFullscreen || document.fullscreenElement) return;
  try {
    const p = el.requestFullscreen({ navigationUI: 'hide' });
    if (p && p.then) p.then(() => {
      fsWorks = true;
      try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ok */ }
    }).catch(() => {});
  } catch (e) { /* ok */ }
}
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) fsWorks = true;
  else if (fsWorks && fsPref && state.started && !state.paused) setPaused(true);   // saiu da tela cheia: pausa
});
function showFsPref() { $('btnFsPref').textContent = fsPref ? 'Tela cheia: obrigatória' : 'Tela cheia: opcional'; }
$('btnFsPref').addEventListener('click', () => { fsPref = !fsPref; store.set('sala_fs', fsPref ? '1' : '0'); showFsPref(); });
showFsPref();
if (!document.fullscreenEnabled) $('fsRow').hidden = true;

function startGame(mode = 'solo') {
  audio.unlock();
  match.mode = mode;
  online.clear();
  restart();
  if (mode === 'solo') { bots.start(player); if (drop.phase) bots.dropStart(); } else bots.stop();
  match.active = true;
  if (fsPref) enterFullscreen();
  state.started = true;
  input.enabled = true;
  state.paused = false;
  character.setHeadVisible(true);
  showScreen(null);
  if (!input.touch) input.requestLock();
}
function resumeGame() {
  audio.unlock();
  if (fsPref && fsWorks && !document.fullscreenElement) enterFullscreen();
  setPaused(false);
}
function toLobby() {
  match.active = false;
  bots.stop();
  if (online.active) net.send({ t: 'unmatch' });
  online.clear();
  restart();
  endDrop();
  state.started = false;
  state.paused = true;
  input.releaseAll(); input.exitLock();
  input.enabled = false;
  showScreen('lobby');
}

// ---- configuracoes
const am = store.get('sala_aimmode', null);
if (am === 'hold' || am === 'toggle') input.aimMode = am;
function showAimMode() { $('btnAimMode').textContent = input.aimMode === 'toggle' ? 'Mira: travada (toque p/ soltar)' : 'Mira: só enquanto segura'; }
$('btnAimMode').addEventListener('click', () => {
  input.aimMode = input.aimMode === 'toggle' ? 'hold' : 'toggle';
  input.aim = false;
  store.set('sala_aimmode', input.aimMode);
  showAimMode();
});
showAimMode();
state.startArmed = store.get('sala_armed', '1') !== '0';
state.armed = state.startArmed;
function showArmedButtons() { $('btnArmedStart').textContent = state.startArmed ? 'Começar: armado (pistola)' : 'Começar: mãos livres'; }
$('btnArmedStart').addEventListener('click', () => {
  state.startArmed = !state.startArmed;
  state.armed = state.startArmed;
  store.set('sala_armed', state.startArmed ? '1' : '0');
  syncWeaponVisual();
  showArmedButtons();
});
showArmedButtons();

document.querySelectorAll('.tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tabPane').forEach((p) => { p.hidden = p.id !== 'tab-' + b.dataset.tab; });
}));
function isMobileDevice() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || (matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints || 0) > 0);
}
const DEVICE_MOBILE = isMobileDevice();
let showMobileHelp = DEVICE_MOBILE;
function showHowTo() {
  $('howMobile').hidden = !showMobileHelp;
  $('howPC').hidden = showMobileHelp;
  $('devName').textContent = (DEVICE_MOBILE ? 'celular' : 'computador') + (showMobileHelp === DEVICE_MOBILE ? '' : ' (vendo ' + (showMobileHelp ? 'celular' : 'computador') + ')');
}
$('btnOtherDev').addEventListener('click', () => { showMobileHelp = !showMobileHelp; showHowTo(); });
showHowTo();
if (DEVICE_MOBILE) { input.touch = true; document.body.classList.add('touch'); }

const hudLayout = new HudLayout({
  onEnter: () => { input.releaseAll(); },
  onExit: () => { input.releaseAll(); showScreen('settings'); },
});
$('btnHud').addEventListener('click', () => {
  for (const n of SCREENS) $(n).classList.remove('show');
  hudLayout.enter();
});

// ---- amigos: salas por codigo (passos 1 e 2 do multiplayer)
const net = new Net();
let friendsMode = 'duo';
let userName = store.get('duskfall_name', '') || store.get('sala_name', '');
function showUser() { $('userName').textContent = userName || '—'; }
let accFromLobby = false;
function openAccount(cancelable) {
  $('accName').value = userName;
  $('accErr').textContent = '';
  $('btnAccCancel').hidden = !cancelable;
  showScreen('account');
}
$('btnAccOk').addEventListener('click', () => {
  const n = $('accName').value.trim().replace(/\s+/g, ' ');
  if (n.length < 2) { $('accErr').textContent = 'Use pelo menos 2 letras'; return; }
  userName = n.slice(0, 16);
  store.set('duskfall_name', userName);
  showUser();
  showScreen('lobby');
  if (net.state().connected) net.send({ t: 'login', name: userName }); else ensureNet();
});
$('accName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnAccOk').click(); });
$('btnAccCancel').addEventListener('click', () => showScreen('lobby'));
$('btnRename').addEventListener('click', () => openAccount(true));
showUser();
function frStatus(t) { $('frStatus').textContent = t || ''; }
function frRender(st) {
  const inRoom = !!(st && st.code);
  $('frLogin').hidden = inRoom;
  $('frRoom').hidden = !inRoom;
  if (!inRoom) return;
  $('frRoomCode').textContent = st.code;
  const list = $('frList');
  list.textContent = '';
  for (const p of st.players) {
    const d = document.createElement('div');
    d.textContent = p.name + (p.host ? '  (anfitrião)' : '');
    if (p.host) d.classList.add('host');
    if (p.id === st.id) d.classList.add('me');
    list.appendChild(d);
  }
  $('btnFrStart').hidden = !st.host;
}
net.on.room = frRender;
net.on.error = (m) => frStatus(m);
net.on.status = (t) => { if (t === 'Desconectado') { frStatus('Desconectado do servidor'); setTimeout(() => { if (userName && !document.hidden) ensureNet(); }, 4000); } renderFriends(); };
net.on.start = () => { frStatus('Entrando na partida…'); };
online.o.net = net;
// ---- conexao automatica com o servidor (o proprio site que serve o jogo)
let serverOk = null;
function wsUrl() {
  const o = store.get('sala_server', '').trim();
  if (o) return /^wss?:/i.test(o) ? o : 'wss://' + o;
  if (!/^https?:$/.test(location.protocol) || !location.host) return '';
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
}
async function serverAvailable() {
  if (serverOk !== null) return serverOk;
  const u = wsUrl();
  if (!u) return (serverOk = false);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(u.replace(/^ws/i, 'http') + '/health', { signal: ctl.signal });
    clearTimeout(t);
    serverOk = /^ok salas-/.test(await r.text());
  } catch (e) { serverOk = false; }
  return serverOk;
}
let connecting = null;
function ensureNet() {
  if (net.ws && net.ws.readyState === 1) return Promise.resolve(true);
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      if (!(await serverAvailable())) return false;
      await net.connect(wsUrl());
      net.send({ t: 'login', name: userName || 'Jogador' });
      return true;
    } catch (e) { return false; } finally { connecting = null; }
  })();
  return connecting;
}
let friends = [];
try { friends = JSON.parse(store.get('duskfall_friends', '[]')) || []; } catch (e) { friends = []; }
let onlineList = [];
let pendingReq = [];
let pendingInv = [];
let foundList = [];
function saveFriends() { store.set('duskfall_friends', JSON.stringify(friends)); }
function isFriend(n) { return friends.some((f) => f.toLowerCase() === n.toLowerCase()); }
function mkRow(name, info, buttons) {
  const r = document.createElement('div'); r.className = 'prow';
  const s = document.createElement('span'); s.textContent = name; r.appendChild(s);
  if (info) { const e = document.createElement('em'); e.textContent = info; r.appendChild(e); }
  for (const [label, fn] of buttons) { const b = document.createElement('button'); b.className = 'btn small'; b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); r.appendChild(b); }
  return r;
}
function renderFriends() {
  const st = net.state();
  $('frNet').textContent = st.connected ? 'Online como ' + userName : (serverOk === false ? 'Sem servidor neste endereço (só jogo contra o computador)' : 'Conectando…');
  const R = $('frResults'); R.textContent = '';
  for (const p of foundList) R.appendChild(mkRow(p.name, isFriend(p.name) ? 'já é amigo' : '', isFriend(p.name) ? [] : [['Adicionar', () => { net.send({ t: 'freq', to: p.id }); frStatus('Pedido enviado para ' + p.name); }]]));
  if (!foundList.length && $('frSearch').value.trim().length >= 2 && st.connected) R.appendChild(mkRow('Ninguém online com esse nome', '', []));
  const Q = $('frReqs'); Q.textContent = '';
  for (const r of pendingReq) Q.appendChild(mkRow(r.from, 'quer ser seu amigo', [['Aceitar', () => { net.send({ t: 'facc', to: r.fid }); pendingReq = pendingReq.filter((x) => x !== r); renderFriends(); updateBadge(); }], ['Recusar', () => { pendingReq = pendingReq.filter((x) => x !== r); renderFriends(); updateBadge(); }]]));
  for (const v of pendingInv) Q.appendChild(mkRow(v.from, 'convidou para ' + v.mode, [['Entrar', () => { friendsMode = v.mode; net.join(v.code, userName); pendingInv = pendingInv.filter((x) => x !== v); updateBadge(); }], ['Recusar', () => { pendingInv = pendingInv.filter((x) => x !== v); renderFriends(); updateBadge(); }]]));
  if (!pendingReq.length && !pendingInv.length) Q.appendChild(mkRow('Nada por aqui', '', []));
  const F = $('frFriends'); F.textContent = '';
  for (const n of friends) {
    const o = onlineList.find((x) => x.name.toLowerCase() === n.toLowerCase());
    const btns = [];
    if (o && st.code) btns.push(['Convidar', () => { net.send({ t: 'invite', to: o.id }); frStatus('Convite enviado para ' + n); }]);
    btns.push(['Remover', () => { friends = friends.filter((x) => x !== n); saveFriends(); renderFriends(); }]);
    F.appendChild(mkRow(n, o ? (o.busy ? 'em partida' : 'online') : 'offline', btns));
  }
  if (!friends.length) F.appendChild(mkRow('Busque um nome acima para adicionar amigos', '', []));
}
function updateBadge() { const n = pendingReq.length + pendingInv.length; $('btnFriends').textContent = n ? 'Amigos (' + n + ')' : 'Amigos'; }
function refreshWho() { if (net.state().connected && friends.length) net.send({ t: 'who', names: friends }); }
setInterval(() => { if ($('friends').classList.contains('show')) { refreshWho(); renderFriends(); } }, 8000);
$('btnFrSearch').addEventListener('click', async () => {
  const q = $('frSearch').value.trim();
  if (q.length < 2) { frStatus('Digite pelo menos 2 letras'); return; }
  frStatus('Buscando…');
  if (!(await ensureNet())) { frStatus('Sem conexão com o servidor'); return; }
  net.send({ t: 'search', q });
});
$('frSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnFrSearch').click(); });
function setMode(mm) { friendsMode = mm; $('btnModeDuo').classList.toggle('on', mm === 'duo'); $('btnModeSquad').classList.toggle('on', mm === 'squad'); }
$('btnModeDuo').addEventListener('click', () => setMode('duo'));
$('btnModeSquad').addEventListener('click', () => setMode('squad'));
net.on.msg = (m) => {
  if (m.t === 'match') {
    if (m.mode !== 'solo') startGame(m.mode);          // grupo: o anfitriao iniciou, todos entram
    else if (!state.started || match.mode !== 'solo') { net.send({ t: 'unmatch' }); return; }
    online.begin(m);
    match.time = Math.max(1, m.left / 1000);
    if (m.mode !== 'solo' || m.teams > 1) bots.stop();
    if (m.mode !== 'solo') toast(m.mode === 'squad' ? 'SQUAD: EQUIPES CONTRA EQUIPES' : 'DUO: PARTIDA ONLINE');
  } else if (m.t === 'mjoin') {
    for (const p of m.players) online.add(p);
    if (m.teams > 1 && bots.enabled) { bots.stop(); toast('UM JOGADOR ENTROU — PARTIDA COMEÇOU!'); }
  } else if (m.t === 'mleft') {
    online.remove(m.id);
  } else if (m.t === 'snap') {
    online.snap(m.p);
  } else if (m.t === 'hit') {
    lastAttacker = m.from;
    hurtPlayer(m.dmg);
  } else if (m.t === 'feed') {
    if (m.killer === online.you) { match.kills++; toast('INIMIGO ABATIDO'); }
    else if (m.victim === online.you) { /* eu morri */ }
    else toast((m.kname || '?') + ' abateu ' + (m.vname || '?'));
  } else if (m.t === 'ev') {
    const a = online.remotes.get(m.from);
    if (m.k === 'shot' && m.d && m.d.a) {
      if (a) a.lastShot = state.time;                // radar: quem atira aparece
      fx.tracer(new THREE.Vector3(...m.d.a), new THREE.Vector3(...m.d.b));
      const dd = Math.hypot(m.d.a[0] - player.x, m.d.a[2] - player.z);
      if (dd < 45 && WEAPONS[m.d.w]) farShot(m.d.w);
    } else if (m.k === 'gren' && m.d) {
      explosives.throwGrenade(m.d.kind, new THREE.Vector3(...m.d.o), new THREE.Vector3(...m.d.v), m.from, Math.min(30, Number(m.d.s) || (m.d.kind === 'gel' ? 13 : 15)));
    } else if (m.k === 'ice' && m.d) {
      explosives.placeIce(m.d.x, m.d.z, m.d.dx, m.d.dz, m.from);
    } else if (m.k === 'bdmg' && m.d) {
      const b = explosives.barrels[m.d.i]; if (b) explosives.damageBarrel(b, Math.min(200, +m.d.dm || 0), null);
    } else if (m.k === 'ign' && m.d) {
      const b = explosives.barrels[m.d.i]; if (b) explosives.ignite(b);
    } else if (m.k === 'crate' && m.d && Number.isFinite(+m.d.x) && Number.isFinite(+m.d.z)) {
      const cc = cleanCrate(m.d.c);
      if (!crateIsEmpty(cc)) spawnCrate(+m.d.x, +m.d.z, Number.isFinite(+m.d.y) ? +m.d.y : 0, cc, String(m.d.id || '').slice(0, 40), false);
    } else if (m.k === 'cget' && m.d) {
      const it = pickups.items.find((i) => i.type === 'crate' && i.cid && i.cid === String(m.d.id));
      if (it) pickups.remove(it);
    }
  } else if (m.t === 'found') { foundList = m.list.filter((p) => !isFriend(p.name)); frStatus(''); renderFriends();
  } else if (m.t === 'online') { onlineList = m.list; renderFriends();
  } else if (m.t === 'freq') { if (!isFriend(m.from) && !pendingReq.some((r) => r.fid === m.fid)) pendingReq.push(m); updateBadge(); renderFriends();
  } else if (m.t === 'friend') { if (!isFriend(m.name)) { friends.push(m.name); saveFriends(); } foundList = foundList.filter((p) => p.name !== m.name); frStatus(m.name + ' agora é seu amigo!'); refreshWho(); renderFriends();
  } else if (m.t === 'invite') { pendingInv.push(m); updateBadge(); renderFriends();
  } else if (m.t === 'sent') { frStatus('Pedido enviado para ' + m.name);
  } else if (m.t === 'login') { refreshWho(); renderFriends();
  } else if (m.t === 'mend') {
    online.clear();
    if (match.active) endMatch();
  }
};
async function frConnectThen(action) {
  frStatus('Conectando…');
  if (!(await ensureNet())) { frStatus('Sem conexão com o servidor'); return; }
  frStatus('');
  action(userName || 'Jogador');
}
$('btnFrCreate').addEventListener('click', () => frConnectThen((n) => net.create(n, friendsMode)));
$('btnFrJoin').addEventListener('click', () => {
  const code = $('frCode').value.trim();
  if (code.length !== 4) { frStatus('O código tem 4 letras'); return; }
  frConnectThen((n) => net.join(code, n));
});
$('btnFrLeave').addEventListener('click', () => { net.leave(); frStatus(''); });
$('btnFrStart').addEventListener('click', () => net.start());
function openFriends(mode) {
  if (mode) setMode(mode);
  frRender(net.state());
  renderFriends();
  showScreen('friends');
  ensureNet().then((ok) => { renderFriends(); if (ok) refreshWho(); });
}
$('btnDuo').addEventListener('click', () => openFriends('duo'));
$('btnSquad').addEventListener('click', () => openFriends('squad'));
$('btnFriends') && $('btnFriends').addEventListener('click', () => openFriends());
$('btnFriendsBack').addEventListener('click', () => showScreen('lobby'));

// ---- instalar como app (atalho na tela inicial)
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('appinstalled', () => { deferredInstall = null; $('installRow').hidden = true; });
if (window.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone) $('installRow').hidden = true;
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('./sw.js').catch(() => {});
$('btnInstall').addEventListener('click', async () => {
  const help = $('installHelp');
  if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) { /* ok */ } deferredInstall = null; return; }
  const ua = navigator.userAgent || '';
  help.hidden = false;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1)) help.textContent = 'iPhone/iPad (Safari): toque no botão Compartilhar (quadrado com seta) → "Adicionar à Tela de Início" → Adicionar.';
  else if (/Android/i.test(ua)) help.textContent = 'Android: abra no Chrome (não pelo navegador de dentro de outro app), toque nos 3 pontinhos → "Instalar app". Se só aparecer "Adicionar à tela inicial", use essa opção: cria o atalho do mesmo jeito.';
  else help.textContent = 'Computador (Chrome/Edge): clique no ícone de instalar na barra de endereço (ou menu ⋮ → "Instalar DUSKFALL"). No Safari do Mac: Arquivo → "Adicionar ao Dock".';
});
function openSettings() { settingsFrom = state.started ? 'pause' : 'lobby'; showScreen('settings'); }
$('btnSettings').addEventListener('click', openSettings);
$('btnSettings2').addEventListener('click', openSettings);
$('btnSettingsBack').addEventListener('click', () => showScreen(settingsFrom === 'pause' && state.started ? 'pause' : 'lobby'));
$('btnChars').addEventListener('click', () => showScreen('chars'));
$('btnCharsBack').addEventListener('click', () => showScreen('lobby'));
$('btnLobby').addEventListener('click', toLobby);

input.onUnlock = () => { if (state.started && !state.paused && !input.touch) setPaused(true); };
$('btnPlay').addEventListener('click', async () => {
  startGame('solo');
  if (await ensureNet()) net.send({ t: 'quick', name: userName || 'Jogador' });   // sem servidor: so contra o computador
});
$('btnResume').addEventListener('click', resumeGame);
$('btnRestart').addEventListener('click', () => { restart(); resumeGame(); });
$('btnRestartTop').addEventListener('click', () => restart());
$('btnPauseTop').addEventListener('click', () => setPaused(!state.paused));
$('btnMute').addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  store.set('sala_mute', audio.muted ? '1' : '0');
  $('btnMute').textContent = audio.muted ? 'Som: desligado' : 'Som: ligado';
});
if (store.get('sala_mute', '0') === '1') { audio.setMuted(true); $('btnMute').textContent = 'Som: desligado'; }
document.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => applyQuality(b.dataset.quality)));
{ const bl = document.getElementById('btnLeve'); if (bl) bl.addEventListener('click', () => setLeve(!leve)); }
document.addEventListener('visibilitychange', () => { if (document.hidden && state.started && !state.paused) setPaused(true); });
// no celular, o primeiro toque ja entra em tela cheia e trava deitado (o app instalado ja abre deitado pelo manifesto)
document.addEventListener('pointerdown', () => { if (DEVICE_MOBILE && fsPref) enterFullscreen(); }, { once: true });
window.addEventListener('touchstart', () => {
  if (!input.touch) { input.touch = true; document.body.classList.add('touch'); }
}, { passive: true, once: false });

// ------------------------------------------------------------------ itens, mochila, HUD de combate
function dropItem(type, id) {
  const fx0 = -Math.sin(view.yaw), fz0 = -Math.cos(view.yaw);
  const dx = player.x + fx0 * 1.3, dz = player.z + fz0 * 1.3;
  pickups.drop(type, id, dx, dz, state.time, groundHeight(dx, dz, player.y + 0.3, world.colliders));
}
function startUse(kind) {
  if (using || match.dead) return;
  if (pack.n[kind] < 1) { toast('SEM ' + ITEM_NAMES[kind].toUpperCase()); return; }
  if (kind === 'bandage' && !vitals.needsBandage) { toast('EP JÁ ESTÁ CHEIO'); return; }
  if (kind === 'medkit' && !vitals.needsMedkit) { toast('VIDA JÁ ESTÁ CHEIA'); return; }
  pack.take(kind);
  using = { kind, t: 0, dur: USE_TIME[kind] };
  if (kind === 'medkit') toast('USANDO KIT MÉDICO…');
}
function healAction() {
  if (vitals.needsMedkit && pack.n.medkit > 0 && vitals.hp < HP_MAX * 0.75) startUse('medkit');
  else if (vitals.needsBandage && pack.n.bandage > 0) startUse('bandage');
  else if (vitals.needsMedkit && pack.n.medkit > 0) startUse('medkit');
  else toast('NADA PARA USAR');
}
function throwNade(kind) {
  if (match.dead || using) return;
  if (pack.n[kind] < 1) { toast('SEM ' + (kind === 'gel' ? 'GRANADA DE GELO' : 'GRANADA')); return; }
  pack.take(kind);
  character.eyePosition(_eye, view.yaw);
  const d = forwardFrom(view.yaw, view.pitch + 0.12, new THREE.Vector3());
  const o = _eye.clone().addScaledVector(d, 0.6);
  const spd = kind === 'gel' ? 13 : NADE_SPEED;
  explosives.throwGrenade(kind, o, d, 'player', spd);
  if (online.active) net.send({ t: 'ev', k: 'gren', d: { kind, o: [o.x, o.y, o.z], v: [d.x, d.y, d.z], s: spd } });
}
// ---- granada de gelo: segura na mao, mostra onde vai ficar e cria a parede NA HORA ao soltar
const ICE_S = EXPLOSIVE_STATS.ICE;
const gelPrev = { x: 0, z: 0, dx: 0, dz: -1, y: 0 };
const gelMat = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
const gelEdge = new THREE.LineBasicMaterial({ color: 0xbff3ff, toneMapped: false, depthTest: false });
const gelBoxes = [[ICE_S.thick, ICE_S.len], [ICE_S.len, ICE_S.thick]].map(([w, d]) => {
  const g = new THREE.BoxGeometry(w, ICE_S.h, d);
  const m = new THREE.Mesh(g, gelMat);
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), gelEdge));
  m.visible = false; m.renderOrder = 15;
  scene.add(m);
  return m;
});
function toggleHand(kind) {
  if (match.dead) return;
  if (state.gelMode && state.handKind === kind) { state.gelMode = false; return; }
  if (pack.n[kind] < 1) { toast(kind === 'gel' ? 'SEM GRANADA DE GELO' : 'SEM GRANADA'); return; }
  state.handKind = kind;
  state.gelMode = true;
  input.fire = false;
  toast(kind === 'gel' ? 'GELO: MIRE E TOQUE EM FOGO' : 'GRANADA: MIRE E TOQUE EM FOGO');
}
function toggleGel() { toggleHand('gel'); }
// ---- granada: linha pontilhada mostra a trajetoria ate onde ela cai (mesma fisica do arremesso)
const NP = 80;
const trajPos = new Float32Array(NP * 3);
const trajGeo = new THREE.BufferGeometry();
trajGeo.setAttribute('position', new THREE.BufferAttribute(trajPos, 3));
const trajPts = new THREE.Points(trajGeo, new THREE.PointsMaterial({ color: 0xffe27a, size: 0.17, sizeAttenuation: true, depthTest: false, transparent: true, opacity: 0.95, toneMapped: false }));
trajPts.frustumCulled = false; trajPts.visible = false; trajPts.renderOrder = 16;
scene.add(trajPts);
const trajRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.65, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
const trajBlast = new THREE.Mesh(new THREE.RingGeometry(6.85, 7, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7a4a, transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
trajRing.visible = false; trajBlast.visible = false; trajRing.renderOrder = 16; trajBlast.renderOrder = 16;
scene.add(trajRing); scene.add(trajBlast);
function updateNadePreview(on) {
  trajPts.visible = trajRing.visible = trajBlast.visible = on;
  if (!on) return;
  character.eyePosition(_eye, view.yaw);
  const d = forwardFrom(view.yaw, view.pitch + 0.12, _v1);
  let px = _eye.x + d.x * 0.6, py = _eye.y + d.y * 0.6, pz = _eye.z + d.z * 0.6;
  let vx = d.x * NADE_SPEED, vy = d.y * NADE_SPEED + 2.6, vz = d.z * NADE_SPEED;
  const dt = 1 / 30;
  let n = 0;
  trajPos[0] = px; trajPos[1] = py; trajPos[2] = pz; n = 1;
  for (let i = 0; i < 70 && n < NP; i++) {
    vy -= 14 * dt;
    const sx = vx * dt, sy = vy * dt, sz = vz * dt;
    const len = Math.hypot(sx, sy, sz) || 1e-6;
    const tb = rayBoxes(px, py, pz, sx / len, sy / len, sz / len, len + 0.05, world.colliders);
    if (tb !== Infinity) { const t = Math.max(0, tb - 0.05); px += sx / len * t; py += sy / len * t; pz += sz / len * t; trajPos[n * 3] = px; trajPos[n * 3 + 1] = py; trajPos[n * 3 + 2] = pz; n++; break; }
    px += sx; py += sy; pz += sz;
    const gy = groundHeight(px, pz, py + 0.4, world.colliders);
    if (py < gy + 0.08) { py = gy + 0.08; trajPos[n * 3] = px; trajPos[n * 3 + 1] = py; trajPos[n * 3 + 2] = pz; n++; break; }
    trajPos[n * 3] = px; trajPos[n * 3 + 1] = py; trajPos[n * 3 + 2] = pz; n++;
  }
  trajGeo.setDrawRange(0, n);
  trajGeo.attributes.position.needsUpdate = true;
  const gy2 = groundHeight(px, pz, py + 0.4, world.colliders);
  trajRing.position.set(px, Math.max(gy2, py - 0.05) + 0.06, pz);
  trajBlast.position.copy(trajRing.position);
}
function updateGelPreview() {
  const on = state.gelMode && !match.dead && state.handKind === 'gel';
  updateNadePreview(state.gelMode && !match.dead && state.handKind === 'frag');
  if (!on) { gelBoxes[0].visible = false; gelBoxes[1].visible = false; return; }
  character.eyePosition(_eye, view.yaw);
  const f = forwardFrom(view.yaw, view.pitch, _v1);
  let t = f.y > 0.05 ? 7 : 16;
  if (f.y < -0.02) t = Math.min(t, (_eye.y - player.y) / -f.y);
  const wl = rayShot(_eye.x, _eye.y, _eye.z, f.x, f.y, f.z, t, world.colliders);
  if (wl) t = Math.max(1.2, wl.t - 0.5);
  const hl = Math.hypot(f.x, f.z) || 1;
  const fx0 = f.x / hl, fz0 = f.z / hl;
  const dh = Math.max(2.4, Math.min(16, t * hl));
  gelPrev.x = player.x + fx0 * dh; gelPrev.z = player.z + fz0 * dh;
  gelPrev.dx = fx0; gelPrev.dz = fz0;
  gelPrev.y = groundHeight(gelPrev.x, gelPrev.z, player.y + 0.8, world.colliders);
  const alongZ = Math.abs(fx0) > Math.abs(fz0);
  const m = gelBoxes[alongZ ? 0 : 1], o = gelBoxes[alongZ ? 1 : 0];
  m.visible = true; o.visible = false;
  m.position.set(gelPrev.x, gelPrev.y + ICE_S.h / 2, gelPrev.z);
}
function placeGel() {
  if (!state.gelMode) return;
  if (state.handKind === 'frag') {                       // botao de atirar = soltar a granada
    if (pack.n.frag < 1) { state.gelMode = false; return; }
    throwNade('frag');
    if (pack.n.frag < 1) state.gelMode = false;
    return;
  }
  if (pack.n.gel < 1) return;
  pack.take('gel');
  explosives.placeIce(gelPrev.x, gelPrev.z, gelPrev.dx, gelPrev.dz, 'player');
  if (online.active) net.send({ t: 'ev', k: 'ice', d: { x: gelPrev.x, z: gelPrev.z, dx: gelPrev.dx, dz: gelPrev.dz } });
  if (pack.n.gel < 1) state.gelMode = false;
}
function openPack() {
  state.gelMode = false;
  if (!state.started) return;
  setPaused(true);
  renderPack();
  showScreen('pack');
}
function closePack() { resumeGame(); }
function renderPack() {
  const L = $('packList');
  L.textContent = '';
  const title = (t) => { const d = document.createElement('div'); d.className = 'ptitle'; d.textContent = t; L.appendChild(d); };
  const row = (name, info, buttons) => {
    const r = document.createElement('div'); r.className = 'prow';
    const s = document.createElement('span'); s.textContent = name; r.appendChild(s);
    if (info) { const e = document.createElement('em'); e.textContent = info; r.appendChild(e); }
    for (const [label, fn] of buttons) { const b = document.createElement('button'); b.className = 'btn small'; b.type = 'button'; b.textContent = label; b.addEventListener('click', () => { fn(); renderPack(); }); r.appendChild(b); }
    L.appendChild(r);
  };
  title('ARMAS (1 pistola + 2 principais)');
  let any = false;
  WEAPON_IDS.forEach((id, i) => {
    if (!loadout.owned[i]) return;
    any = true;
    const st = loadout.states[i];
    row(WEAPONS[id].name + (loadout.index === i && state.armed ? ' (na mão)' : ''), st.mag + ' / ' + st.reserve, [
      ['Descartar', () => { loadout.discard(i); dropItem('weapon', id); state.armed = state.armed && loadout.owned[loadout.index]; prevWeaponIndex = -1; syncWeaponVisual(); }],
      st.reserve > 0 ? ['Largar munição', () => { const k = WEAPONS[id].ammo; st.reserve = 0; dropItem('ammo', k); }] : null,
    ].filter(Boolean));
  });
  if (!any) row('Nenhuma arma', '', []);
  title('MIRAS');
  if (loadout.has4x) row('Mira 4x', 'FAMAS / SCAR', [['Descartar', () => { loadout.has4x = false; pack.scope4x = false; dropItem('scope', '4x'); }]]);
  else row('Nenhuma mira extra', '', []);
  title('ITENS');
  const kinds = ['bandage', 'medkit', 'frag', 'gel'];
  for (const k of kinds) {
    const n = pack.n[k];
    if (!n) continue;
    const btns = [];
    if (k === 'bandage' || k === 'medkit') btns.push(['Usar', () => { closePack(); startUse(k); }]);
    else btns.push([k === 'gel' ? 'Usar' : 'Jogar', () => { closePack(); if (k === 'gel') toggleGel(); else throwNade(k); }]);
    btns.push(['Descartar 1', () => { pack.take(k); dropItem(k, { bandage: 'a', medkit: 'k', frag: 'f', gel: 'g' }[k]); }]);
    row(ITEM_NAMES[k], 'x' + n + ' / ' + ITEM_CAP[k], btns);
  }
  if (!kinds.some((k) => pack.n[k])) row('Sem itens', '', []);
}
$('btnPackBack').addEventListener('click', closePack);
function updateCombatHud() {
  const hp = Math.round(vitals.hp), ep = Math.round(vitals.ep);
  if (hudCache.hp !== hp) { hudCache.hp = hp; $('hpFill').style.transform = `scaleX(${hp / HP_MAX})`; $('hpTxt').textContent = 'HP ' + hp; }
  if (hudCache.ep !== ep) { hudCache.ep = ep; $('epFill').style.transform = `scaleX(${ep / EP_MAX})`; $('epTxt').textContent = 'EP ' + ep; }
  setText('nb', $('nBand'), String(pack.n.bandage)); setText('nm', $('nMed'), String(pack.n.medkit));
  setText('nf', $('nFrag'), String(pack.n.frag)); setText('ng', $('nGel'), String(pack.n.gel));
  setText('bh', $('bHeal'), String(pack.n.bandage + pack.n.medkit)); setText('bf', $('bFrag'), String(pack.n.frag)); setText('bg', $('bGel'), String(pack.n.gel));
  const t = Math.max(0, Math.ceil(match.time));
  setText('mt', $('mTime'), Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'));
  setText('mk', $('mKills'), 'ABATES ' + match.kills + '  •  MORTES ' + match.deaths);
  const ub = $('useBar');
  setClass('ub', ub, 'on', !!using);
  if (using) $('useFill').style.transform = `scaleX(${using.t / using.dur})`;
  const ho = (Math.round((Math.max(0, hurtT) * 1.4 + (vitals.hp < 50 ? 0.25 : 0)) * 20) / 20).toFixed(2);
  if (hudCache.ho !== ho) { hudCache.ho = ho; $('hurt').style.opacity = ho; }
  if (hurtT > 0) hurtT -= 0.016;
}
function endMatch() {
  match.active = false;
  const acc = stats.accuracy.toFixed(1) + '%';
  const rl = $('resList');
  rl.textContent = '';
  for (const [k, v] of [['Abates', match.kills], ['Mortes', match.deaths], ['Pontos', stats.score], ['Precisão', acc]]) {
    const d = document.createElement('div'); const s1 = document.createElement('span'); const s2 = document.createElement('b'); s1.textContent = k; s2.textContent = String(v); d.appendChild(s1); d.appendChild(s2); rl.appendChild(d);
  }
  setPaused(true);
  showScreen('results');
}
$('btnAgain').addEventListener('click', () => { if (match.mode === 'solo') startGame('solo'); else toLobby(); });
$('btnResLobby').addEventListener('click', () => { toLobby(); });

// ------------------------------------------------------------------ atualizacao
const shootables = [];
const occluders = world.occluders;
for (const m of occluders) shootables.push(m);
for (const m of world.targetMeshes) shootables.push(m);

function update(dt) {
  state.time += dt;
  const w = loadout.current;
  if (match.active) {
    match.time -= dt;
    if (match.time <= 0) { endMatch(); return; }
    if (match.dead) { match.deadT -= dt; $('deadSub').textContent = 'Voltando em ' + Math.ceil(Math.max(0, match.deadT)) + ' s'; if (match.deadT <= 0) respawnPlayer(); }
  }
  const dead = match.dead;
  const dropOn = drop.phase !== null;
  if (heli.root.visible) drop.ht += dt;
  if (dropOn) { input.fire = false; input.aim = false; input.takeFirePressed(); state.gelMode = false; state.alignK = 1; }
  if (dead) { input.fire = false; input.aim = false; input.takeFirePressed(); }
  vitals.update(dt);
  if (using) {
    using.t += dt;
    {
      const ur = $('useRing');
      if (ur) { ur.className = 'on ' + (using.kind === 'medkit' ? 'k' : 'b'); $('useArc').style.strokeDashoffset = String(213.6 * (1 - Math.min(1, using.t / using.dur))); }
    }
    if (using.t >= using.dur) {
      if (using.kind === 'bandage') { vitals.addBandage(); toast('+ EP'); } else { vitals.addMedkit(); toast('VIDA RESTAURADA'); }
      audio.heal();
      using = null;
      { const ur = $('useRing'); if (ur) ur.className = ''; }
    }
  }
  if (online.active) { online.update(dt); online.sendState(dt, player, view, state.armed ? loadout.currentId : null, Math.max(state.crouchK, state.proneK), !dead); }
  explosives.update(dt);
  bots.update(dt, {
    player: { x: player.x, y: player.y, z: player.z, alive: !dead, speed: player.speed }, time: state.time, heli: heliAt(drop.ht),
    hitPlayer: (dmg, bot, zone) => { hurtPlayer(zone === 'cabeca' ? dmg * 2 : dmg); },
    tracer: (a, b) => fx.tracer(a, b),
    sound: (id, dist) => { if (dist < 40) farShot(id); },
  });

  // ---- acoes pontuais
  const acts = input.takeActions();
  if (acts) {
    for (const a of acts) {
      if (a === 'pause') setPaused(true);
      else if (a === 'restart') restart();
      else if (a === 'reload') { state.gelMode = false; if (state.armed && w.startReload()) audio.reload(loadout.currentId, w.cfg.reloadTime); }
      else if (a === 'swap') { state.gelMode = false; cycleWeapon(); }
      else if (a === 'hands') { if (state.armed) holster(); else switchWeapon(loadout.index); }
      else if (a === 'prone') { state.prone = !state.prone; if (state.prone) { state.crouch = false; input.runToggle = false; $('btnRun').classList.remove('on'); } }
      else if (a === 'crouch') { state.prone = false; state.crouch = !state.crouch; if (state.crouch) { input.runToggle = false; $('btnRun').classList.remove('on'); } }
      else if (a === 'dropbtn' || (a === 'jump' && drop.phase)) dropAction();
      else if (a === 'jump') { if (state.prone) state.prone = false; else if (state.grounded) { player.vy = 4.9; state.grounded = false; state.crouch = false; audio.jump(); } }
      else if (/^w[1-8]$/.test(a)) { state.gelMode = false; switchWeapon(Number(a[1]) - 1); }
      else if (a === 'heal') healAction();
      else if (a === 'frag') toggleHand('frag');
      else if (a === 'gel') toggleGel();
      else if (a === 'pack') openPack();
      else if (a === 'loot') { if (lootEntries.length) takeLoot(lootEntries[0]); }
    }
  }

  // ---- olhar (mouse/toque)
  input.takeLook(_lk);
  const zoomNow = state.aimBlend > 0.5 && !state.gelMode ? loadout.zoom : 1;
  const sens = input.sensitivity * (state.aimBlend > 0.5 ? 0.62 : 1) / (zoomNow > 1 ? Math.pow(zoomNow, 0.75) : 1);
  view.yaw -= _lk.x * sens;
  view.pitch = clamp(view.pitch - _lk.y * sens, -1.2, 1.2);
  view.yaw = wrapAngle(view.yaw);
  view.recoil = Math.max(0, view.recoil - (0.012 + view.recoil * 5.5) * dt); // a mira volta aos poucos

  // ---- mira (ADS)
  if (!state.armed && !state.gelMode) input.aim = false;
  const wantAim = input.aim && (state.armed || state.gelMode) && !w.reloading;
  const aimStep = 16 * dt; // ~0,06 s para entrar/sair da mira
  state.aimBlend = wantAim ? Math.min(1, state.aimBlend + aimStep) : Math.max(0, state.aimBlend - aimStep);
  const aiming = state.aimBlend > 0.5;

  // ---- ajuda de mira: ao mirar ou atirar, a mira acompanha o oponente (bot ou jogador) que esta perto do centro e visivel
  if (!dead && state.armed && !state.gelMode && !using && input.enabled && (input.fire || aiming)) {
    character.eyePosition(_eye, view.yaw);
    const maxR = WEAPONS[loadout.currentId].range || 80;
    const cone = aiming ? 0.16 : 0.24;                     // angulo maximo (rad) para capturar o alvo
    let bestE = cone, bYaw = 0, bPitch = 0, found = false;
    const consider = (tx, ty, tz) => {
      const dx = tx - _eye.x, dy = ty - _eye.y, dz = tz - _eye.z;
      const hd = Math.hypot(dx, dz);
      const d = Math.hypot(hd, dy);
      if (d < 1.2 || d > Math.min(maxR, 90)) return;
      const ty2 = Math.atan2(-dx, -dz);
      const tp = Math.atan2(dy, hd);
      const ey = wrapAngle(ty2 - view.yaw), ep = tp - (view.pitch + view.recoil);
      const e = Math.hypot(ey * Math.cos(tp), ep);
      if (e >= bestE) return;
      if (rayShot(_eye.x, _eye.y, _eye.z, dx / d, dy / d, dz / d, d - 0.3, world.colliders)) return;   // parede no caminho
      bestE = e; bYaw = ey; bPitch = ep; found = true;
    };
    if (bots.enabled) for (const b of bots.bots) if (b.alive) consider(b.x, b.y + 1.3, b.z);
    if (online.active) for (const a of online.remotes.values()) if (a.alive && a.team !== online.team && a.tgt) consider(a.x, a.y + 1.3 - 0.4 * (a.crouch || 0), a.z);
    if (found) {
      const lookMag = Math.hypot(_lk.x, _lk.y);
      const rate = (input.fire ? 11 : 4.5) / (1 + lookMag * 0.04);   // mexer a mira na mao tem prioridade
      const kk = 1 - Math.exp(-rate * dt);
      view.yaw = wrapAngle(view.yaw + bYaw * kk);
      view.pitch = clamp(view.pitch + bPitch * kk, -1.2, 1.2);
    }
  }

  // ---- movimento
  input.readMove(_mv);
  if (dead) { _mv.x = 0; _mv.y = 0; }
  if (input.runToggle) {
    if (aiming) { input.runToggle = false; $('btnRun').classList.remove('on'); }     // mirar cancela a corrida
    else if (Math.hypot(_mv.x, _mv.y) < 0.15) { _mv.x = 0; _mv.y = 1; }              // botao CORRER: sai correndo para frente mesmo parado
  }
  const sprinting = input.sprint && !dead && !aiming && !w.reloading && _mv.y > 0.3 && Math.abs(_mv.x) < _mv.y * 1.2; // corre so para frente
  if (sprinting && state.crouch) state.crouch = false;   // correr levanta o personagem
  if (sprinting && state.prone) state.prone = false;
  state.crouchK += ((state.crouch ? 1 : 0) - state.crouchK) * Math.min(1, 12 * dt);
  state.proneK += ((state.prone ? 1 : 0) - state.proneK) * Math.min(1, 9 * dt);
  const maxSpeed = dropOn ? 0 : state.prone ? (aiming ? PRONE_AIM : PRONE_WALK) : state.crouch ? (aiming ? 1.4 : 2.0) : aiming ? AIM_WALK : sprinting ? RUN : WALK;
  const mag = Math.hypot(_mv.x, _mv.y);
  _fwd.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
  _rgt.set(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
  const wx = (_fwd.x * _mv.y + _rgt.x * _mv.x);
  const wz = (_fwd.z * _mv.y + _rgt.z * _mv.x);
  const tvx = wx * maxSpeed * (sprinting ? 1 : Math.min(1, mag));
  const tvz = wz * maxSpeed * (sprinting ? 1 : Math.min(1, mag));
  const accel = mag > 0.01 ? 24 : 34; // resposta rapida ao controle
  const k = 1 - Math.exp(-accel * dt);
  player.vx += (tvx - player.vx) * k;
  player.vz += (tvz - player.vz) * k;
  // passos curtos para nao atravessar nada
  const stepLen = Math.hypot(player.vx, player.vz) * dt;
  const sub = Math.max(1, Math.ceil(stepLen / 0.12));
  const p2 = { x: player.x, z: player.z };
  for (let i = 0; i < sub; i++) {
    p2.x += (player.vx * dt) / sub;
    p2.z += (player.vz * dt) / sub;
    resolveMovement(p2, PLAYER_RADIUS, world.colliders, 4, player.y);
  }
  // velocidade real (apos colisao): evita "correr no lugar" contra a parede
  const rdx = p2.x - player.x;
  const rdz = p2.z - player.z;
  player.x = p2.x; player.z = p2.z;
  const realSpeed = dt > 0 ? Math.hypot(rdx, rdz) / dt : 0;
  player.speed += (realSpeed - player.speed) * Math.min(1, 12 * dt);
  // caixas de municao do cenario ('short' = pistola/submetralhadora, 'long' = fuzis)
  const picked = world.collectNear(player.x, player.z, player.y);
  if (picked.length) {
    let got = 0;
    for (const k of picked) got += loadout.addAmmo(k);
    audio.pickup();
    toast(got > 0 ? (picked[0] === 'long' ? '+ MUNIÇÃO LONGA' : '+ MUNIÇÃO CURTA') : 'MUNIÇÃO CHEIA');
  }
  // armas, mira 4x e mais municao espalhadas pelo mapa
  pickups.update(dt, state.time, player.x, player.z);
  updateLootPanel(dead);
  // gravidade e contato com o piso
  const gY = groundHeight(player.x, player.z, player.y, world.colliders);
  if (dropOn) {
    // helicoptero / queda livre / paraquedas: mesmas regras para todos; pouso sem dano
    const hp = heliAt(drop.ht);
    state.grounded = false; state.airK = 0; wasAir = false; fallPeak = 0; player.vx = player.vz = 0; player.speed = 0;
    if (drop.phase === 'heli') {
      player.x = hp.x + DOOR.x; player.y = hp.y; player.z = hp.z + DOOR.z; player.vy = 0;
      if (hp.end) dropAction();
    } else {
      const d = drop.d;
      let mx = wx, mz = wz; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
      const land = stepDrop(d, dt, gY, mx, mz);
      const q = { x: d.x, z: d.z };
      resolveMovement(q, PLAYER_RADIUS, world.colliders, 4, d.y);
      d.x = q.x; d.z = q.z;
      player.x = d.x; player.y = d.y; player.z = d.z; player.vy = d.vy;
      if (d.phase === 'chute' && drop.phase === 'fall') { drop.phase = 'chute'; if (d.auto) toast('PARAQUEDAS ABERTO'); showDropBtn(); }
      playerChute.visible = d.phase === 'chute';
      playerChute.position.set(d.x, d.y, d.z); playerChute.rotation.y = view.yaw; playerChute.scale.setScalar(0.2 + 0.8 * d.open);
      if (land) { player.y = gY; player.vy = 0; state.grounded = true; endDrop(false); }
    }
  } else {
  if (state.grounded && player.vy <= 0 && player.y > gY && player.y - gY < 0.2) player.y = gY;   // acompanha elevadores descendo e degraus
  player.vy -= 9.81 * dt;
  player.y += player.vy * dt;
  if (player.y <= gY) { player.y = gY; player.vy = 0; }
  state.grounded = player.y <= gY + 0.02 && player.vy <= 0;
  state.airK += ((state.grounded ? 0 : 1) - state.airK) * Math.min(1, 16 * dt);
  if (!state.grounded) { fallPeak = wasAir ? Math.max(fallPeak, player.y) : player.y; wasAir = true; }
  else if (wasAir) {
    wasAir = false;
    const fd = fallDamage(fallPeak - player.y, LETHAL_H);
    if (fd > 0 && !dead) { hurtPlayer(fd); toast('QUEDA  -' + fd); }
  }
  }

  // ---- giro do corpo
  // Em acao (mirando, atirando ou andando) o corpo acompanha a mira. Parado, o corpo fica quieto e a camera
  // gira 360 graus em volta do personagem. Ao mirar a camera vai para os olhos e continua girando livre.
  const moving = player.speed > 0.15;
  state.fireHold = Math.max(0, state.fireHold - dt);
  const inAction = aiming || state.fireHold > 0 || moving || dropOn;
  const dyaw = wrapAngle(view.yaw - player.hipsYaw);
  const rate = inAction ? 12 : 0;
  player.hipsYaw = wrapAngle(player.hipsYaw + clamp(dyaw, -rate * dt, rate * dt));
  state.alignK += ((inAction ? 1 : 0) - state.alignK) * Math.min(1, (inAction ? 14 : 5) * dt);
  if (state.alignK > 0.995) state.alignK = 1;
  if (state.alignK < 0.005) state.alignK = 0;

  // velocidade no referencial do corpo (direita / frente), para o ciclo de pernas (frente, re, lado)
  const hx = -Math.sin(player.hipsYaw);
  const hz = -Math.cos(player.hipsYaw);
  const localFwd = player.vx * hx + player.vz * hz;
  const localRight = player.vx * Math.cos(player.hipsYaw) - player.vz * Math.sin(player.hipsYaw);

  // ---- armas: tempo, disparo
  loadout.update(dt);
  syncWeaponVisual();
  const firedPressed = input.takeFirePressed();
  if (state.gelMode && firedPressed && !dead && !using && input.enabled) placeGel();
  const allowFire = input.enabled && !state.paused && state.armed && !state.gelMode && !dead && !using && !dropOn;
  updateGelPreview();
  if (allowFire) {
    const res = w.tryFire(input.fire, firedPressed);
    if (res === 'fired') {
      if (state.alignK < 1) { state.alignK = 1; player.hipsYaw = view.yaw; }
      shoot();
    }
    else if (res === 'dry') {
      audio.dry();
      if (w.startReload()) audio.reload(loadout.currentId, w.cfg.reloadTime);
    } else if (input.fire && w.mag === 0 && w.reserve > 0 && w.ready) {
      if (w.startReload()) audio.reload(loadout.currentId, w.cfg.reloadTime);
    }
  }

  // animacao do ferrolho: recua no tiro; na USP vazia fica aberto
  const id = loadout.currentId;
  state.slide = Math.max(0, state.slide - dt * (id === 'usp' ? 16 : 22));
  const slideShown = id === 'usp' && w.mag === 0 && !w.reloading ? 1 : state.slide;
  state.recoilVis = Math.max(0, state.recoilVis - dt * 9);

  // ---- encosto da arma na parede: puxa a arma para tras
  const rig = rigs[id];
  character.eyePosition(_eye, view.yaw);
  forwardFrom(view.yaw, view.pitch + view.recoil, _fwd);
  const wdh = rayShot(_eye.x, _eye.y, _eye.z, _fwd.x, _fwd.y, _fwd.z, 1.2, world.colliders);   // gradis nao encolhem a arma
  const wd = wdh ? wdh.t : Infinity;
  const wantPull = wd === Infinity ? 0 : clamp(0.62 - wd, 0, 0.42);
  state.wallPull += (wantPull - state.wallPull) * Math.min(1, 14 * dt);

  // ---- personagem
  character.root.position.set(player.x, player.y, player.z);
  const aimPitch = view.pitch + view.recoil;
  character.update(dt, {
    speed: player.speed, lx: localRight, lz: localFwd, hipsYaw: player.hipsYaw,
    aimYaw: wrapAngle(player.hipsYaw + wrapAngle(view.yaw - player.hipsYaw) * state.alignK), aimPitch: aimPitch * state.alignK,
    crouch: state.crouchK * (1 - state.proneK), air: dropOn ? 0 : state.airK,
    aimBlend: state.aimBlend, rig: state.armed && !state.gelMode ? rig : null,
    draw: w.cfg.drawTime > 0 ? 1 - w.drawT / w.cfg.drawTime : 1,
    reload: w.reloading ? w.reloadProgress : -1,
    recoil: state.recoilVis, slide: slideShown, wallPull: state.wallPull,
  });
  // deitado (posicao de atirador de elite): o corpo deita para a frente
  character.proneK = state.proneK;
  character.root.rotation.order = 'YXZ';
  character.root.rotation.x = -1.45 * state.proneK;
  if (character.stepEvent !== state.lastStep) {
    state.lastStep = character.stepEvent;
    audio.step(player.speed > 3.2);
  }
  character.setHeadVisible(state.aimBlend < 0.55);

  // ---- luneta: esconde arma e bracos e mostra a mira da lente quando a mira esta toda aberta
  const zoom = loadout.zoom;
  const isAwm = loadout.currentId === 'awm';
  const scoped = (state.armed || state.gelMode) && state.aimBlend > 0.6;   // mirando: so a mira (sem maos nem arma)
  rigs[loadout.currentId].group.visible = state.armed && !scoped && !state.gelMode;
  if (character.skin) character.skin.group.visible = !scoped;
  const showScope = (state.armed || state.gelMode) && state.aimBlend > 0.92;
  setClass('scope', $('scope'), 'on', showScope);
  setClass('scopeS', $('scope'), 'sniper', isAwm && !state.gelMode);
  setClass('scopeR', $('scope'), 'ring', !isAwm || state.gelMode);
  if (showScope) setText('scz', $('scopeZoom'), isAwm && !state.gelMode ? zoom + 'x' : '');

  // ---- luzes naturais (sol so ao ar livre; luz de apoio acompanha o personagem)
  const outside = player.z < ROOM.minZ + 0.2 || Math.abs(player.x) > ROOM.maxX + 0.2 ? 1 : 0;
  state.outdoor += (outside - state.outdoor) * Math.min(1, 3 * dt);
  const od = state.outdoor;
  sun.intensity = 3.2 * od;
  sun.position.set(player.x - 40, player.y + 70, player.z - 30);
  sun.target.position.set(player.x, player.y, player.z);
  skyFill.intensity = 0.9 * od;
  world.hemi.intensity = HEMI_BASE + 0.25 * od;
  scene.environmentIntensity = 0.45 + 0.5 * od;
  keyLight.intensity = 0.55 + 0.5 * od;
  keyLight.position.set(player.x + Math.sin(view.yaw) * 4 + 2.5, player.y + 5, player.z + Math.cos(view.yaw) * 4);
  keyLight.target.position.set(player.x, player.y + 1, player.z);

  // ---- camera hibrida
  updateCamera(dt, aimPitch);

  // ---- mundo e efeitos
  world.update(dt, state.time);
  fx.update(dt);
  heli.update(dt);
  if (heli.root.visible) { const hp = heliAt(drop.ht); heli.set(hp.x, hp.y, hp.z); if (hp.end && !dropOn) heli.show(false); }

  // ---- HUD
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) hud.toast.classList.remove('show'); }
  if (hitT > 0) { hitT -= dt; if (hitT <= 0) hud.hit.classList.remove('on'); }
  hud.cross.classList.toggle('ads', state.aimBlend > 0.5);
  $('btnAim').classList.toggle('down', input.aim);
  setClass('bgel', $('btnGel'), 'down', state.gelMode && state.handKind === 'gel');
  setClass('bfragb', $('btnFrag'), 'down', state.gelMode && state.handKind === 'frag');
  setClass('bprone', $('btnProne'), 'on', state.prone);
  hud.cross.style.opacity = String(showScope ? 0 : 1 - state.aimBlend * 0.4);
  updateHud();
  updateCombatHud();
}

function updateCamera(dt, pitch) {
  const yaw = view.yaw;
  if (drop.phase === 'heli') {                 // primeira pessoa na porta do helicoptero
    camera.position.set(player.x, player.y + 1.65, player.z);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    if (camera.fov !== 78) { camera.fov = 78; camera.updateProjectionMatrix(); }
    return;
  }
  _rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));
  forwardFrom(yaw, pitch, _fwd);
  const base = _v1.set(player.x, player.y + 1.52 - 0.5 * state.crouchK - 1.0 * state.proneK, player.z);
  // sobre o ombro direito; se houver parede/caixa ao lado, o afastamento lateral diminui
  const side = rayBoxes(base.x, base.y, base.z, _rgt.x, 0, _rgt.z, 0.55, world.colliders);
  const off = (side === Infinity ? 0.42 : clamp(side - 0.12, 0, 0.42)) * state.alignK;
  const pivot = _v2.copy(base).addScaledVector(_rgt, off);
  // posicao desejada atras do jogador
  const wantDist = 2.5;
  const back = _v3.copy(_fwd).multiplyScalar(-1);
  back.y += 0.12;
  back.normalize();
  // a camera nao atravessa paredes: raio do pivo ate a posicao desejada
  const t = rayBoxes(pivot.x, pivot.y, pivot.z, back.x, back.y, back.z, wantDist + 0.3, world.colliders);
  let allowed = t === Infinity ? wantDist : Math.max(0.28, t - 0.28);
  // teto e piso
  const inRoom = player.z > ROOM.minZ + 0.35 && Math.abs(player.x) < ROOM.maxX;
  const ceilY = inRoom ? ROOM.h - 0.2 : 80;                  // fora da sala nao ha teto
  if (back.y > 0.001) allowed = Math.min(allowed, (ceilY - pivot.y) / back.y);
  if (back.y < -0.001) allowed = Math.min(allowed, (0.18 - pivot.y) / back.y);
  allowed = Math.max(0.28, allowed);
  // aproxima na hora (sem atravessar); afasta suavemente
  if (allowed < state.camDist) state.camDist = allowed;
  else state.camDist += (allowed - state.camDist) * Math.min(1, 6 * dt);

  const tp = _cam.copy(pivot).addScaledVector(back, state.camDist);
  character.eyePosition(_eye, yaw);
  const s = smooth(state.aimBlend);
  camera.position.lerpVectors(tp, _eye, s);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  if (shakeT > 0) { shakeT -= dt; const k = shakeT * 0.09; camera.position.x += (Math.random() - 0.5) * k; camera.position.y += (Math.random() - 0.5) * k; }
  const fov = TP_FOV + (adsFov(state.gelMode ? 1 : loadout.zoom) - TP_FOV) * s;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

// ------------------------------------------------------------------ lobby: o operador em idle, camera em volta dele
// lobby 360: arrastar o dedo/mouse na area livre gira em volta do personagem
let lobbyYaw = 0, lobbyTouched = false, lobbyDrag = null;
{
  const le = $('lobby');
  if (le) {
    le.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, input, select, textarea, a, label')) return;
      lobbyDrag = { x: e.clientX, id: e.pointerId };
      try { le.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    });
    le.addEventListener('pointermove', (e) => {
      if (!lobbyDrag || e.pointerId !== lobbyDrag.id) return;
      lobbyYaw -= (e.clientX - lobbyDrag.x) * 0.012;
      lobbyDrag.x = e.clientX; lobbyTouched = true;
    });
    const end = (e) => { if (lobbyDrag && e.pointerId === lobbyDrag.id) lobbyDrag = null; };
    le.addEventListener('pointerup', end); le.addEventListener('pointercancel', end);
  }
}
function lobbyScene(dt) {
  state.time += dt;
  world.update(dt, state.time);
  pickups.update(dt, state.time, 1e5, 1e5);
  player.x = SPAWN.x; player.z = SPAWN.z; player.y = 0;
  character.root.position.set(player.x, 0, player.z);
  character.update(dt, {
    speed: 0, lx: 0, lz: 0, hipsYaw: player.hipsYaw, aimYaw: player.hipsYaw, aimPitch: 0, aimBlend: 0,
    rig: state.startArmed ? rigs.usp : null, draw: 1, reload: -1, recoil: 0, slide: 0, wallPull: 0,
  });
  character.setHeadVisible(true);
  if (character.skin) character.skin.group.visible = true;
  for (const id of WEAPON_IDS) rigs[id].group.visible = state.startArmed && id === 'usp';
  prevWeaponIndex = -1;
  // sol quente de por do sol tambem no lobby
  state.outdoor += (1 - state.outdoor) * Math.min(1, 3 * dt);
  const od = state.outdoor;
  sun.intensity = 3.2 * od; skyFill.intensity = 0.9 * od; keyLight.intensity = 0.55 + 0.5 * od;
  sun.position.set(player.x - 30, 40, player.z - 30);
  sun.target.position.set(player.x, 0, player.z);
  const ang = player.hipsYaw + lobbyYaw + (lobbyTouched ? 0 : Math.sin(state.time * 0.35) * 0.55);   // vai e volta; depois de arrastar, fica onde voce deixou
  const fx0 = -Math.sin(ang), fz0 = -Math.cos(ang);
  camera.position.set(player.x + fx0 * 2.7, 1.45, player.z + fz0 * 2.7);
  // personagem desloca para a direita da tela (menu a esquerda)
  const rx = Math.cos(ang), rz = -Math.sin(ang);
  camera.lookAt(player.x + rx * 0.9 * (window.innerWidth > window.innerHeight ? 1 : 0), 1.15, player.z + rz * 0.9 * (window.innerWidth > window.innerHeight ? 1 : 0));
  if (camera.fov !== 50) { camera.fov = 50; camera.updateProjectionMatrix(); }
}


// ------------------------------------------------------------------ escala da interface + radar
function setUiScale() {
  const h = window.innerHeight, w = window.innerWidth;
  let k = Math.max(0.62, Math.min(1, Math.min(h, w) / 440));
  if (COARSE) k *= 0.93;
  try { document.documentElement.style.setProperty('--ui', k.toFixed(3)); } catch (e) { /* sem DOM */ }
}
setUiScale();
window.addEventListener('resize', setUiScale);
window.addEventListener('orientationchange', () => setTimeout(setUiScale, 250));

const radarEl = $('radar');
const radarCtx = radarEl && radarEl.getContext ? radarEl.getContext('2d') : null;
const RADAR_RANGE = 55;          // metros ate a borda
const RADAR_SHOW = 3;            // segundos que o inimigo fica no radar depois de atirar
let radarT = 0;
function drawRadar(dt) {
  if (!radarCtx) return;
  radarT += dt;
  if (radarT < 0.066) return;                        // ~15 quadros/s bastam (barato)
  const tNow = state.time;
  radarT = 0;
  const g = radarCtx, S = 132, C = S / 2, R = C - 3;
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(6,16,10,0.62)'; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(90,255,140,0.28)'; g.lineWidth = 1;
  for (const f of [0.34, 0.67, 1]) { g.beginPath(); g.arc(C, C, R * f, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(C, C - R); g.lineTo(C, C + R); g.moveTo(C - R, C); g.lineTo(C + R, C); g.stroke();
  // varredura do scanner (feixe com rastro)
  const sw = tNow * 2.2;
  for (let i = 0; i < 10; i++) {
    g.strokeStyle = `rgba(90,255,140,${0.34 * (1 - i / 10)})`;
    g.lineWidth = 2;
    const a = sw - i * 0.07;
    g.beginPath(); g.moveTo(C, C); g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R); g.stroke();
  }
  const yaw = view.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const dot = (x, z, col, rad, clampEdge, alpha) => {
    const dx = x - player.x, dz = z - player.z;
    let sx = (dx * rx + dz * rz) / RADAR_RANGE, sy = (dx * fx + dz * fz) / RADAR_RANGE;
    const d = Math.hypot(sx, sy);
    if (d > 1) { if (!clampEdge) return; sx /= d; sy /= d; }
    const px = C + sx * (R - 5), py = C - sy * (R - 5);
    g.globalAlpha = alpha;
    g.fillStyle = col;
    g.beginPath(); g.arc(px, py, rad, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  };
  // amigos da equipe: sempre aparecem (verde)
  if (online.active) for (const a of online.remotes.values()) if (a.alive && a.team === online.team) dot(a.x, a.z, '#5cff8a', 3.2, false, 0.95);
  // inimigos: so aparecem enquanto atiram (vermelho, apagando)
  const enemy = (x, z, ls) => {
    const age = tNow - (ls == null ? -1e9 : ls);
    if (age < 0 || age > RADAR_SHOW) return;
    const al = 1 - age / RADAR_SHOW;
    dot(x, z, '#ff3b30', 3.6 + (1 - al) * 2, true, 0.35 + 0.65 * al);
  };
  if (bots.enabled) for (const b of bots.bots) if (b.alive) enemy(b.x, b.z, b.lastShot);
  if (online.active) for (const a of online.remotes.values()) if (a.alive && a.team !== online.team) enemy(a.x, a.z, a.lastShot);
  g.restore();
  g.strokeStyle = 'rgba(90,255,140,0.75)'; g.lineWidth = 2;
  g.beginPath(); g.arc(C, C, R, 0, Math.PI * 2); g.stroke();
  // voce: triangulo branco no centro, apontando para cima (para onde olha)
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(C, C - 6); g.lineTo(C + 4.5, C + 5); g.lineTo(C, C + 2.5); g.lineTo(C - 4.5, C + 5); g.closePath(); g.fill();
}

// ------------------------------------------------------------------ laco
let shadowTick = 0;
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;                       // ate 10 fps o jogo anda em tempo real (antes ficava em camera lenta)
  if (dt <= 0) return;
  const portrait = input.touch && window.innerHeight > window.innerWidth;
  if (state.started && !state.paused) { if (!portrait) { update(dt); drawRadar(dt); } }
  else if (!state.started) lobbyScene(dt);
  scenery.update(camera, state.started && !state.paused ? dt : 0);
  shadowTick++;
  if (renderer.shadowMap.enabled && (shadowTick % 4 === 0)) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) {
    const fps = Math.round(fpsN / fpsAcc);
    const el = $('fps');
    if (el) el.textContent = fps + ' fps · v21';
    if (state.started && !state.paused) {
      adaptT += 1;
      const prev = resScale;
      if (fps < 40 && resScale > 0.7 && adaptT >= 2) { resScaleCap = resScale - 0.05; resScale = Math.max(0.7, resScale - 0.1); adaptT = 0; }
      else if (fps >= 58 && resScale < Math.min(1, resScaleCap) && adaptT >= 12) { resScale = Math.min(Math.min(1, resScaleCap), resScale + 0.05); adaptT = 0; }   // sobe devagar e nunca volta ao nivel que travou
      // so PERGUNTA (uma vez por sessao); nunca liga o modo leve sozinho
      if (fps < 24) { lowFps += 1; if (lowFps >= 8 && !leve && !askedLite) { askedLite = true; lowFps = 0; askLite(); } } else lowFps = 0;
      if (resScale !== prev) applyRes();
    }
    fpsAcc = 0; fpsN = 0;
  }
}

// ------------------------------------------------------------------ inicializacao
function init() {
  applyQuality(qualityName, true);
  loadout.reset();
  syncWeaponVisual();
  // pose inicial para o primeiro quadro ja ter personagem e arma no lugar
  character.root.position.set(player.x, 0, player.z);
  character.update(0.016, {
    speed: 0, lx: 0, lz: 0, hipsYaw: player.hipsYaw, aimYaw: view.yaw, aimPitch: 0, aimBlend: 0,
    rig: rigs.usp, draw: 1, reload: -1, recoil: 0, slide: 0, wallPull: 0,
  });
  updateHud();
  if (matchMedia('(pointer: coarse)').matches) { input.touch = true; document.body.classList.add('touch'); }
  $('loading').classList.add('hide');
  if (!userName) openAccount(false); else { showScreen('lobby'); ensureNet(); }
  requestAnimationFrame(frame);
}

// expoe para depuracao e testes no navegador
window.__sala = { drop, dropAction, heli, net, online, vitals, pack, match, bots, explosives, scene, camera, renderer, world, character, loadout, stats, player, view, state, shoot, restart, switchWeapon, input, audio, pickups, loot: { entries: () => lootEntries, take: (i) => takeLoot(lootEntries[i]), el: lootEl } };

try {
  init();
} catch (e) {
  console.error(e);
  const el = $('loading');
  el.classList.remove('hide');
  el.textContent = 'Erro ao iniciar: ' + e.message;
}
