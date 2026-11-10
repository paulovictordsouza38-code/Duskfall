// DUSKFALL ISLAND - malha do terreno em setores (grade cfg.grid x cfg.grid). Cada setor e uma malha propria
// com cores por vertice (sem texturas: leve) e normais calculadas da propria funcao de altura (sem emendas).
// Fase 2: todos os setores sao construidos de uma vez (em lotes). A Fase 3 troca isso por carga/descarga.
import * as THREE from 'three';

const COL = {
  sand: new THREE.Color(0xd8c690), wet: new THREE.Color(0x9a8a62), sea: new THREE.Color(0x4f6f70),
  grass: new THREE.Color(0x5f8f45), forest: new THREE.Color(0x2f5a30), city: new THREE.Color(0x77756f),
  rock: new THREE.Color(0x7d766c), dark: new THREE.Color(0x56514a), snow: new THREE.Color(0xf1f4f6),
};

export class TerrainManager {
  constructor(scene, sampler, cfg) {
    this.scene = scene; this.sampler = sampler; this.cfg = cfg;
    this.group = new THREE.Group(); this.group.name = 'ilha-terreno';
    scene.add(this.group);
    this.n = cfg.grid;
    this.sector = cfg.size / cfg.grid;
    this.chunks = [];
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  _color(x, z, h, slope, out) {
    const s = this.sampler; const hh = h - s.sea;
    if (hh < -0.4) { out.copy(COL.sea).lerp(COL.wet, Math.max(0, 1 + hh / 8)); return out; }
    if (hh < 0.8) { out.copy(COL.wet).lerp(COL.sand, Math.max(0, hh / 0.8)); return out; }
    if (hh < 3) { out.copy(COL.sand).lerp(COL.grass, smooth01(1.6, 3, hh)); }
    else out.copy(COL.grass);
    for (const r of s.regions) {
      const w = s._regionWeight(r, x, z);
      if (w <= 0) continue;
      const tint = r.type === 'plateau' ? COL.city : r.type === 'hills' ? COL.forest : COL.dark;
      out.lerp(tint, Math.min(1, w * 1.4) * (r.type === 'mountain' ? 0.35 : 0.85));
    }
    const rock = Math.max(smooth01(0.5, 1.0, slope), smooth01(30, 52, hh) * 0.6);
    if (rock > 0) out.lerp(COL.rock, rock);
    if (hh > 52) out.lerp(COL.snow, smooth01(52, 66, hh) * (1 - smooth01(0.7, 1.4, slope) * 0.6));
    // faixas de 5 m de altitude: ajudam a ler a escala do relevo nesta fase de teste
    const band = (Math.floor(hh / 5) & 1) ? 0.96 : 1.0;
    out.multiplyScalar(band);
    return out;
  }

  _buildChunk(ix, iz) {
    const seg = this.cfg.segments; const step = this.sector / seg;
    const x0 = -this.cfg.size / 2 + ix * this.sector; const z0 = -this.cfg.size / 2 + iz * this.sector;
    const N = seg + 1; const P = N + 2;                       // grade de alturas com 1 de folga em cada lado
    const hs = new Float32Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) hs[j * P + i] = this.sampler.height(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const pos = new Float32Array(N * N * 3); const nor = new Float32Array(N * N * 3); const col = new Float32Array(N * N * 3);
    const c = new THREE.Color();
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * N + i; const pi = (j + 1) * P + (i + 1);
        const x = x0 + i * step; const z = z0 + j * step; const h = hs[pi];
        const dx = hs[pi + 1] - hs[pi - 1]; const dz = hs[pi + P] - hs[pi - P];
        const l = Math.hypot(dx, 2 * step, dz);
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        nor[k * 3] = -dx / l; nor[k * 3 + 1] = 2 * step / l; nor[k * 3 + 2] = -dz / l;
        this._color(x, z, h, Math.hypot(dx, dz) / (2 * step), c);
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }
    const idx = new Uint16Array(seg * seg * 6); let q = 0;
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = j * N + i; const b = a + 1; const d = a + N; const e = d + 1;
      idx[q++] = a; idx[q++] = d; idx[q++] = b; idx[q++] = b; idx[q++] = d; idx[q++] = e;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    let mn = Infinity; let mx = -Infinity;
    for (let k = 0; k < N * N; k++) { const y = pos[k * 3 + 1]; if (y < mn) mn = y; if (y > mx) mx = y; }
    g.boundingBox = new THREE.Box3(new THREE.Vector3(x0, mn, z0), new THREE.Vector3(x0 + this.sector, mx, z0 + this.sector));
    g.boundingSphere = new THREE.Sphere(); g.boundingBox.getBoundingSphere(g.boundingSphere);
    const m = new THREE.Mesh(g, this.material);
    m.matrixAutoUpdate = false; m.userData = { ix, iz };
    this.group.add(m);
    return m;
  }

  /** Constroi todos os setores, cedendo o controle entre lotes (a tela nao congela). */
  async buildAll(onProgress) {
    const total = this.n * this.n; let done = 0;
    for (let iz = 0; iz < this.n; iz++) {
      for (let ix = 0; ix < this.n; ix++) {
        this.chunks.push(this._buildChunk(ix, iz));
        done++;
        if (done % 4 === 0) { if (onProgress) onProgress(done / total); await new Promise((r) => setTimeout(r, 0)); }
      }
    }
    if (onProgress) onProgress(1);
  }

  /** Esconde setores alem da distancia de visao (alem do frustum culling automatico do Three). */
  update(cam, far) {
    const lim = far + this.sector * 0.75;
    let vis = 0;
    for (const m of this.chunks) {
      const s = m.geometry.boundingSphere;
      const v = Math.hypot(s.center.x - cam.x, s.center.z - cam.z) < lim;
      m.visible = v; if (v) vis++;
    }
    return vis;
  }

  dispose() {
    for (const m of this.chunks) { m.geometry.dispose(); this.group.remove(m); }
    this.chunks.length = 0; this.material.dispose(); this.scene.remove(this.group);
  }
}

function smooth01(a, b, v) { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
