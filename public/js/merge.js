// Junta objetos fixos do cenario que usam o mesmo material em poucos blocos (por regiao do mapa):
// o celular desenha MUITO menos coisas por quadro (menos "draw calls") e o visual fica igual.

/** Dados de geometria "crus": { pos: number[], nor: number[]|null, uv: number[]|null, index: number[]|null } */
export function unindex(d) {
  if (!d.index) return { pos: Array.from(d.pos), nor: d.nor ? Array.from(d.nor) : null, uv: d.uv ? Array.from(d.uv) : null };
  const n = d.index.length;
  const pos = new Array(n * 3);
  const nor = d.nor ? new Array(n * 3) : null;
  const uv = d.uv ? new Array(n * 2) : null;
  for (let i = 0; i < n; i++) {
    const v = d.index[i];
    pos[i * 3] = d.pos[v * 3]; pos[i * 3 + 1] = d.pos[v * 3 + 1]; pos[i * 3 + 2] = d.pos[v * 3 + 2];
    if (nor) { nor[i * 3] = d.nor[v * 3]; nor[i * 3 + 1] = d.nor[v * 3 + 1]; nor[i * 3 + 2] = d.nor[v * 3 + 2]; }
    if (uv) { uv[i * 2] = d.uv[v * 2]; uv[i * 2 + 1] = d.uv[v * 2 + 1]; }
  }
  return { pos, nor, uv };
}

/**
 * Aplica a matriz 4x4 (coluna-maior, como o Three.js) a uma geometria sem indice.
 * Espelhamento (determinante negativo) inverte a ordem dos triangulos para as faces nao ficarem viradas ao contrario.
 */
export function transformData(d, e) {
  const n = d.pos.length / 3;
  const pos = new Array(n * 3);
  const nor = new Array(n * 3);
  const det = e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
  // matriz normal = inversa transposta da parte 3x3
  const a = e[0], b = e[4], c = e[8], dd = e[1], ee = e[5], f = e[9], g = e[2], h = e[6], i2 = e[10];
  const A = ee * i2 - f * h, B = -(dd * i2 - f * g), C = dd * h - ee * g;
  const D = -(b * i2 - c * h), E = a * i2 - c * g, F = -(a * h - b * g);
  const G = b * f - c * ee, H = -(a * f - c * dd), I = a * ee - b * dd;
  const dt = a * A + b * B + c * C || 1;
  const k = 1 / dt;
  // inversa = adj/det ; transposta da inversa => linhas de cofatores
  const n00 = A * k, n01 = B * k, n02 = C * k, n10 = D * k, n11 = E * k, n12 = F * k, n20 = G * k, n21 = H * k, n22 = I * k;
  for (let v = 0; v < n; v++) {
    const x = d.pos[v * 3], y = d.pos[v * 3 + 1], z = d.pos[v * 3 + 2];
    pos[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    pos[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    pos[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    if (d.nor) {
      const nx = d.nor[v * 3], ny = d.nor[v * 3 + 1], nz = d.nor[v * 3 + 2];
      let X = n00 * nx + n01 * ny + n02 * nz, Y = n10 * nx + n11 * ny + n12 * nz, Z = n20 * nx + n21 * ny + n22 * nz;
      const L = Math.hypot(X, Y, Z) || 1;
      nor[v * 3] = X / L; nor[v * 3 + 1] = Y / L; nor[v * 3 + 2] = Z / L;
    }
  }
  const uv = d.uv ? d.uv.slice() : null;
  let out = { pos, nor: d.nor ? nor : null, uv };
  if (det < 0) out = flipWinding(out);
  if (!out.nor) out.nor = flatNormals(out.pos);
  return out;
}

export function flipWinding(d) {
  const pos = d.pos.slice(), nor = d.nor ? d.nor.slice() : null, uv = d.uv ? d.uv.slice() : null;
  const tris = pos.length / 9;
  for (let t = 0; t < tris; t++) {
    const a = t * 9 + 3, b = t * 9 + 6;                       // troca o 2o e o 3o vertice
    for (let k = 0; k < 3; k++) {
      let s = pos[a + k]; pos[a + k] = pos[b + k]; pos[b + k] = s;
      if (nor) { s = nor[a + k]; nor[a + k] = nor[b + k]; nor[b + k] = s; }
    }
    if (uv) { const ua = t * 6 + 2, ub = t * 6 + 4; for (let k = 0; k < 2; k++) { const s = uv[ua + k]; uv[ua + k] = uv[ub + k]; uv[ub + k] = s; } }
  }
  return { pos, nor, uv };
}

export function flatNormals(pos) {
  const nor = new Array(pos.length);
  for (let t = 0; t < pos.length; t += 9) {
    const ux = pos[t + 3] - pos[t], uy = pos[t + 4] - pos[t + 1], uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t], vy = pos[t + 7] - pos[t + 1], vz = pos[t + 8] - pos[t + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const L = Math.hypot(x, y, z) || 1; x /= L; y /= L; z /= L;
    for (let k = 0; k < 3; k++) { nor[t + k * 3] = x; nor[t + k * 3 + 1] = y; nor[t + k * 3 + 2] = z; }
  }
  return nor;
}

/** Junta varias geometrias (todas com uv, ou todas sem). */
export function concatData(list) {
  let nv = 0;
  for (const d of list) nv += d.pos.length / 3;
  const hasUv = list.every((d) => d.uv);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = hasUv ? new Float32Array(nv * 2) : null;
  let o = 0, ou = 0;
  for (const d of list) {
    pos.set(d.pos, o * 3); nor.set(d.nor, o * 3);
    if (hasUv) { uv.set(d.uv, ou); ou += d.uv.length; }
    o += d.pos.length / 3;
  }
  return { pos, nor, uv };
}

const ALLOWED = new Set(['position', 'normal', 'uv']);
const CELL = 48;

/**
 * Percorre `root` e funde as malhas fixas (matrixAutoUpdate=false) que dividem o mesmo material.
 * Retorna { before, after } (quantidade de malhas).
 */
export function mergeStaticMeshes(THREE, root, opts = {}) {
  const skip = opts.skip || (() => false);
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const tmp = new THREE.Matrix4();
  let before = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) return;
    for (let p = o; p; p = p.parent) if (p.userData && (p.userData.dynamic || p.userData.noMerge)) return;
    if (o.matrixAutoUpdate !== false || skip(o)) return;
    const m = o.material;
    if (!m || Array.isArray(m) || m.transparent || m.opacity < 1) return;
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    for (const k of Object.keys(g.attributes)) if (!ALLOWED.has(k)) return;
    if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
    if (m.map && !g.attributes.uv) return;
    before++;
    const cx = Math.floor(o.matrixWorld.elements[12] / CELL), cz = Math.floor(o.matrixWorld.elements[14] / CELL);
    const key = m.uuid + '|' + cx + '|' + cz + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + '|' + (g.attributes.uv ? 1 : 0);
    let grp = groups.get(key);
    if (!grp) { grp = { material: m, cast: o.castShadow, receive: o.receiveShadow, meshes: [] }; groups.set(key, grp); }
    grp.meshes.push(o);
  });
  let after = 0;
  for (const grp of groups.values()) {
    if (grp.meshes.length < 2) { after += grp.meshes.length; continue; }
    const parts = [];
    const used = [];
    for (const o of grp.meshes) {
      const g = o.geometry;
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      const cnt = P.count;
      const pos = new Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i); }
      let nor = null;
      if (N) { nor = new Array(cnt * 3); for (let i = 0; i < cnt; i++) { nor[i * 3] = N.getX(i); nor[i * 3 + 1] = N.getY(i); nor[i * 3 + 2] = N.getZ(i); } }
      let uv = null;
      if (U) { uv = new Array(cnt * 2); for (let i = 0; i < cnt; i++) { uv[i * 2] = U.getX(i); uv[i * 2 + 1] = U.getY(i); } }
      let index = null;
      if (g.index) { index = new Array(g.index.count); for (let i = 0; i < index.length; i++) index[i] = g.index.getX(i); }
      if (!index && cnt % 3 !== 0) continue;
      tmp.copy(rootInv).multiply(o.matrixWorld);
      parts.push(transformData(unindex({ pos, nor, uv, index }), tmp.elements));
      used.push(o);
    }
    if (used.length < 2) { after += grp.meshes.length; continue; }
    const out = concatData(parts);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(out.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(out.nor, 3));
    if (out.uv) geo.setAttribute('uv', new THREE.BufferAttribute(out.uv, 2));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, grp.material);
    mesh.castShadow = grp.cast; mesh.receiveShadow = grp.receive;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'fundido';
    root.add(mesh);
    mesh.updateMatrix();
    for (const o of used) { if (o.parent) o.parent.remove(o); }
    after += 1 + (grp.meshes.length - used.length);
  }
  return { before, after };
}
