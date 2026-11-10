// DUSKFALL ISLAND - desenha os objetos de cada setor (arvores, rochas, predios) com InstancedMesh:
// UMA geometria e UM material compartilhados por todos os setores; cada setor so tem a lista de posicoes.
// As posicoes vem do PropPlacer (puro e deterministico).
import * as THREE from 'three';
import { placeProps, BUILDING_CLASSES, FLOOR_H } from './PropPlacer.js';

const FOUND = FLOOR_H;     // fundacao enterrada (esconde o vao em terreno levemente inclinado; mantem as janelas alinhadas)

export class PropsManager {
  constructor(scene, sampler, cfg) {
    this.sampler = sampler; this.cfg = cfg;
    this.group = new THREE.Group(); this.group.name = 'ilha-objetos'; scene.add(this.group);
    this.scene = scene;
    this.vcolMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.treeGeo = this._tree(); this.rockGeo = this._rock();
    this.facade = this._facadeTexture();
    this.bMat = new THREE.MeshLambertMaterial({ map: this.facade });
    this.bGeos = BUILDING_CLASSES.map((c) => this._building(c));
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0); this._col = new THREE.Color();
    this.live = { trees: 0, rocks: 0, buildings: 0 };
  }

  /** Junta geometrias simples numa so (sem indice), com uma cor por parte. */
  _merge(parts) {
    let n = 0; const flat = parts.map(({ geo, color }) => { const g = geo.index ? geo.toNonIndexed() : geo; n += g.attributes.position.count; return { g, color }; });
    const pos = new Float32Array(n * 3); const nor = new Float32Array(n * 3); const col = new Float32Array(n * 3);
    let o = 0; const c = new THREE.Color();
    for (const { g, color } of flat) {
      const cnt = g.attributes.position.count; c.set(color);
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
      o += cnt;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }

  _tree() {
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 6, 1, true); trunk.translate(0, 1.3, 0);
    const c1 = new THREE.ConeGeometry(2.4, 4.4, 7, 1, true); c1.translate(0, 4.0, 0);
    const c2 = new THREE.ConeGeometry(1.8, 3.6, 7, 1, true); c2.translate(0, 6.0, 0);
    const c3 = new THREE.ConeGeometry(1.1, 2.6, 7, 1, true); c3.translate(0, 7.7, 0);
    return this._merge([{ geo: trunk, color: 0x5a3d26 }, { geo: c1, color: 0x27472b }, { geo: c2, color: 0x30552f }, { geo: c3, color: 0x3a6637 }]);
  }
  _rock() { return this._merge([{ geo: new THREE.IcosahedronGeometry(1, 0), color: 0x817b72 }]); }

  _facadeTexture() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#cbc4b6'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#9d968a'; g.fillRect(0, 60, 64, 4);                 // faixa de laje entre andares
    g.fillStyle = '#2f4358'; g.fillRect(12, 12, 40, 36);               // vidro
    g.fillStyle = '#4f6f8d'; g.fillRect(14, 14, 36, 14);               // reflexo
    g.fillStyle = '#8a8478'; g.fillRect(31, 12, 2, 36);                // montante
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _building(c) {
    const h = c.floors * FLOOR_H + FOUND;
    const g = new THREE.BoxGeometry(c.w, h, c.d); g.translate(0, h / 2 - FOUND, 0);
    const uv = g.attributes.uv; const a = uv.array;
    // ordem do BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices cada). Laterais repetem a janela a cada 3,5 m x 3,3 m.
    for (let f = 0; f < 6; f++) {
      const width = f < 2 ? c.d : f >= 4 ? c.w : 0;
      for (let v = 0; v < 4; v++) {
        const i = (f * 4 + v) * 2;
        if (width === 0) { a[i] = 0.03; a[i + 1] = 0.03; }              // teto/piso: so parede lisa
        else { a[i] *= width / 3.5; a[i + 1] *= h / FLOOR_H; }
      }
    }
    uv.needsUpdate = true;
    return g;
  }

  /** Cria os objetos do setor. Devolve { group, meshes, n } (use release para devolver). */
  buildSector(ix, iz) {
    const p = placeProps(this.sampler, this.cfg, ix, iz);
    const g = new THREE.Group(); const meshes = [];
    const m = this._m; const q = this._q; const pos = this._p; const sc = this._s; const up = this._up;
    if (p.trees.length) {
      const im = new THREE.InstancedMesh(this.treeGeo, this.vcolMat, p.trees.length);
      p.trees.forEach((t, i) => { pos.set(t.x, t.y - 0.15, t.z); q.setFromAxisAngle(up, t.r); sc.set(t.s, t.s * (0.9 + (t.r % 1) * 0.3), t.s); m.compose(pos, q, sc); im.setMatrixAt(i, m); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); g.add(im); meshes.push(im);
    }
    if (p.rocks.length) {
      const im = new THREE.InstancedMesh(this.rockGeo, this.vcolMat, p.rocks.length);
      p.rocks.forEach((r, i) => { pos.set(r.x, r.y + r.sy * 0.3, r.z); q.setFromAxisAngle(up, r.r); sc.set(r.sx, r.sy, r.sz); m.compose(pos, q, sc); im.setMatrixAt(i, m); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); g.add(im); meshes.push(im);
    }
    if (p.buildings.length) {
      BUILDING_CLASSES.forEach((cls, k) => {
        const list = p.buildings.filter((b) => b.cls === k); if (!list.length) return;
        const im = new THREE.InstancedMesh(this.bGeos[k], this.bMat, list.length);
        list.forEach((b, i) => {
          pos.set(b.x, b.y, b.z); q.setFromAxisAngle(up, b.r); sc.set(1, 1, 1); m.compose(pos, q, sc); im.setMatrixAt(i, m);
          this._col.setHSL(0.09 + b.tint * 0.07, 0.12 + b.tint * 0.18, 0.78 + b.tint * 0.2); im.setColorAt(i, this._col);
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); g.add(im); meshes.push(im);
      });
    }
    this.group.add(g);
    const n = { trees: p.trees.length, rocks: p.rocks.length, buildings: p.buildings.length };
    this.live.trees += n.trees; this.live.rocks += n.rocks; this.live.buildings += n.buildings;
    return { group: g, meshes, n, placed: p };
  }

  releaseSector(item) {
    this.group.remove(item.group);
    for (const m of item.meshes) m.dispose();         // libera so os buffers de instancia; a geometria e compartilhada
    this.live.trees -= item.n.trees; this.live.rocks -= item.n.rocks; this.live.buildings -= item.n.buildings;
  }

  dispose() {
    this.scene.remove(this.group);
    this.treeGeo.dispose(); this.rockGeo.dispose(); this.bGeos.forEach((g) => g.dispose());
    this.vcolMat.dispose(); this.bMat.dispose(); this.facade.dispose();
  }
}
