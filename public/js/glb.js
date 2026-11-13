// Leitor simples de GLB (so o que o helicoptero precisa: malhas com posicao/uv/indices e 1 textura JPEG).
import * as THREE from 'three';

export function parseGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('glb');
  let off = 12, json = null, bin = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const s = off + 8;
    if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, s, len)));
    else if (type === 0x004E4942) bin = buf.slice(s, s + len);
    off = s + len;
  }
  return { json, bin };
}

/** devolve { root, parts: {nome: Object3D} }; a textura carrega depois (a malha ja aparece com cor cinza escuro) */
export function buildGLB(buf) {
  const { json: g, bin } = parseGLB(buf);
  const mat = new THREE.MeshLambertMaterial({ color: 0x9a9a9a, side: THREE.DoubleSide });
  const root = new THREE.Group(); const parts = {};
  const sizes = { 5126: 4, 5123: 2, 5125: 4 };
  const read = (ai) => {
    const a = g.accessors[ai], v = g.bufferViews[a.bufferView];
    const n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type]);
    const o = (v.byteOffset || 0) + (a.byteOffset || 0);
    return a.componentType === 5126 ? new Float32Array(bin, o, n) : a.componentType === 5123 ? new Uint16Array(bin, o, n) : new Uint32Array(bin, o, n);
  };
  for (const nd of g.nodes) {
    const p = g.meshes[nd.mesh].primitives[0];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(read(p.attributes.POSITION), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(read(p.attributes.TEXCOORD_0), 2));
    geo.setIndex(new THREE.BufferAttribute(read(p.indices), 1));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.fromArray(nd.translation || [0, 0, 0]);
    m.frustumCulled = false;
    root.add(m); parts[nd.name] = m;
  }
  try {
    const iv = g.bufferViews[g.images[0].bufferView];
    const blob = new Blob([new Uint8Array(bin, iv.byteOffset || 0, iv.byteLength)], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    new THREE.TextureLoader().load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true; URL.revokeObjectURL(url); });
  } catch (e) { /* fica cinza */ }
  return { root, parts };
}
