// Tela de TESTE da Fase 2: anda pela ilha em primeira pessoa para validar o terreno (altura, inclinacao, praia, relevo).
// Nao usa o main.js nem o cenario atual. Nao tem armas, bots nem multiplayer (fases seguintes).
import * as THREE from 'three';
import { IslandWorld } from './IslandWorld.js';

const $ = (id) => document.getElementById(id);
const COARSE = matchMedia('(pointer:coarse)').matches;
const cfg = await (await fetch('./js/island.json', { cache: 'no-store' })).json();
if (COARSE) { cfg.viewDistance = 260; cfg.maxLoaded = 36; }   // celular: menos alcance e menos setores na memoria

const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(COARSE ? 1 : Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.1, cfg.viewDistance + 60);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const island = new IslandWorld(scene, cfg);
await island.build();
const S = island.sampler;

// ------------------------------------------------------------- jogador (somente teste de terreno)
const EYE = 1.65; const MAX_SLOPE = 1.28;      // ~52 graus: mais ingreme que isso nao se sobe
const WATER_LIMIT = -1.3;                      // ate a altura do peito dentro d'agua
const p = { x: 40, z: 130, y: 0, vy: 0, yaw: Math.PI, pitch: 0, run: false };
p.y = S.height(p.x, p.z);
await island.preload(p.x, p.z, (q) => { $('load').textContent = 'Carregando setores... ' + Math.round(q * 100) + '%'; });
$('load').style.display = 'none';

const TP = [['Praia', 40, 212], ['Cidade', 40, 60], ['Floresta', -170, 40]];
for (const [n, x, z] of TP) {
  const b = document.createElement('button'); b.textContent = n;
  b.onclick = () => { p.x = x; p.z = z; p.y = S.height(x, z); p.vy = 0; };
  $('tp').appendChild(b);
}
$('tp').addEventListener('pointerdown', (e) => e.stopPropagation());
$('act').addEventListener('pointerdown', (e) => e.stopPropagation());
let pinned = false;
$('bPin').onclick = () => { pinned = !pinned; $('bPin').classList.toggle('on', pinned); if (pinned) island.track('teste', p.x, p.z); else island.untrack('teste'); };
$('bRun').onclick = () => { p.run = !p.run; $('bRun').classList.toggle('on', p.run); };
$('bJump').onclick = () => { if (p.y <= S.height(p.x, p.z) + 0.05) p.vy = 4.9; };

// ------------------------------------------------------------- entrada: metade esquerda anda, direita olha
const keys = {}; const mv = { x: 0, z: 0 };
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') $('bJump').onclick(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
const touches = new Map();
addEventListener('pointerdown', (e) => {
  const left = e.clientX < innerWidth * 0.5 && e.pointerType === 'touch';
  touches.set(e.pointerId, { left, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
  if (left) { const st = $('stick'); st.style.display = 'block'; st.style.left = (e.clientX - 55) + 'px'; st.style.top = (e.clientY - 55) + 'px'; st.style.bottom = 'auto'; }
});
addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId); if (!t) return;
  if (t.left) {
    const dx = Math.max(-50, Math.min(50, e.clientX - t.ox)); const dy = Math.max(-50, Math.min(50, e.clientY - t.oy));
    mv.x = dx / 50; mv.z = dy / 50;
    $('knob').style.transform = 'translate(' + dx * 0.7 + 'px,' + dy * 0.7 + 'px)';
  } else {
    p.yaw -= (e.clientX - t.x) * 0.006; p.pitch = Math.max(-1.3, Math.min(1.3, p.pitch - (e.clientY - t.y) * 0.006));
    t.x = e.clientX; t.y = e.clientY;
  }
});
function up(e) {
  const t = touches.get(e.pointerId); if (!t) return;
  if (t.left) { mv.x = 0; mv.z = 0; $('stick').style.display = 'none'; $('knob').style.transform = ''; }
  touches.delete(e.pointerId);
}
addEventListener('pointerup', up); addEventListener('pointercancel', up);

// ------------------------------------------------------------- loop
function walkable(x, z) { return S.inBounds(x, z) && S.height(x, z) - S.sea > WATER_LIMIT && S.slope(x, z) < MAX_SLOPE; }
function step(dt) {
  let fx = mv.x + ((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0));
  let fz = mv.z + ((keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0));
  const l = Math.hypot(fx, fz);
  if (l > 1) { fx /= l; fz /= l; }
  const run = p.run || keys.ShiftLeft;
  const sp = (run ? 7 : 4) * dt;
  const sin = Math.sin(p.yaw); const cos = Math.cos(p.yaw);
  const dx = (fx * cos + fz * sin) * sp; const dz = (-fx * sin + fz * cos) * sp;
  if (walkable(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; }
  else if (walkable(p.x + dx, p.z)) p.x += dx;
  else if (walkable(p.x, p.z + dz)) p.z += dz;
  const g = S.height(p.x, p.z);
  p.vy -= 14 * dt; p.y += p.vy * dt;
  if (p.y <= g) { p.y = g; p.vy = 0; }
}

const hud = $('hud'); let fps = 30; let last = performance.now(); let acc = 0; let frames = 0; let low = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  step(dt);
  camera.position.set(p.x, p.y + EYE, p.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  island.update(camera.position);
  renderer.render(scene, camera);
  acc += dt; frames++;
  if (acc >= 0.5) {
    fps = frames / acc; acc = 0; frames = 0;
    const id = S.regionAt(p.x, p.z); const r = renderer.info; const st = island.stats();
    hud.textContent = 'ilha ' + cfg.mapVersion + ' | ' + fps.toFixed(0) + ' fps' + (fps < 30 ? '  (ABAIXO DE 30)' : '') +
      '\n' + S.regionName(id) + '  x ' + p.x.toFixed(0) + '  z ' + p.z.toFixed(0) + '  alt ' + (p.y - S.sea).toFixed(1) + ' m' +
      '\ninclinacao ' + (Math.atan(S.slope(p.x, p.z)) * 57.3).toFixed(0) + ' graus' +
      '\nsetores carregados ' + st.loaded + '/' + cfg.grid * cfg.grid + ' (fila ' + st.pending + ', retidos ' + st.retained + ')  setor ' + st.cx + ',' + st.cz +
      '\nconstruidos ' + st.builds + '  descarregados ' + st.unloads + '  build medio ' + st.avgMs.toFixed(1) + ' / pior ' + st.maxMs.toFixed(1) + ' ms' + (st.capped ? '  (limite: ' + st.capped + ' fora)' : '') +
      '\narvores ' + st.props.trees + '  rochas ' + st.props.rocks + '  predios ' + st.props.buildings + '  (objetos: medio ' + st.propAvg.toFixed(1) + ' / pior ' + st.propMax.toFixed(1) + ' ms)' +
      '\ndraw ' + r.render.calls + '  tris ' + (r.render.triangles / 1000).toFixed(0) + 'k  geometrias ' + r.memory.geometries + '  malha ~' + st.mb.toFixed(1) + ' MB';
    low = fps < 30 ? low + 1 : 0;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__island = { island, p, S };   // para inspecao no console
