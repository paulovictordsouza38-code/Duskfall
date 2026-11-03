// Auxiliares de geometria: caixas arredondadas (sem aparencia de bloco), UVs por tamanho real.
import * as THREE from 'three';

const cache = new Map();

/** Caixa com arestas chanfradas/arredondadas, centrada na origem. Geometrias iguais sao reaproveitadas. */
export function roundedBox(w, h, d, r = 0.01) {
  const key = [w, h, d, r].map((v) => v.toFixed(4)).join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const rr = Math.max(0.0005, Math.min(r, w * 0.49, h * 0.49, d * 0.49));
  const iw = w / 2 - rr;
  const ih = h / 2 - rr;
  const s = new THREE.Shape();
  s.moveTo(-iw, -ih);
  s.lineTo(iw, -ih);
  s.lineTo(iw, ih);
  s.lineTo(-iw, ih);
  s.closePath();
  const depth = Math.max(0.0005, d - 2 * rr);
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: rr,
    bevelSize: rr,
    bevelOffset: 0,
    bevelSegments: 2,
    curveSegments: 1,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  cache.set(key, g);
  return g;
}

/** BoxGeometry com UV proporcional ao tamanho real (tile = metros por repeticao da textura). */
export function texturedBox(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z (4 vertices cada)
  const dims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = dims[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * (fw / tile), uv.getY(i) * (fh / tile));
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Cilindro deitado ao longo de um eixo ('x' | 'y' | 'z'). */
export function cylinderAlong(axis, radius, length, radial = 16) {
  const g = new THREE.CylinderGeometry(radius, radius, length, radial, 1);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

/** Plano com UV em metros (para repetir texturas em paredes e piso). */
export function tiledPlane(w, h, tile = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (h / tile));
  }
  uv.needsUpdate = true;
  return g;
}
