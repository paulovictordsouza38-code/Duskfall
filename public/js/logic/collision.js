// Colisao 2D (planta baixa) para o jogador + raio 3D contra caixas (camera e arma).
// Modulo puro: nao depende do Three.js, entao pode ser testado no Node.

export function makeBox(minX, minZ, maxX, maxZ, minY = 0, maxY = 10) {
  return { circle: false, minX, minZ, maxX, maxZ, minY, maxY };
}

export function makeCircle(x, z, r, minY = 0, maxY = 10) {
  return { circle: true, x, z, r, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, minY, maxY };
}

/** Move um colisor circular (alvos moveis) mantendo a caixa envolvente em dia. */
export function moveCircle(c, x, z) {
  c.x = x; c.z = z;
  c.minX = x - c.r; c.maxX = x + c.r; c.minZ = z - c.r; c.maxZ = z + c.r;
}

/**
 * Empurra `pos` ({x,z}) para fora dos colisores. Retorna true se houve correcao.
 * O jogador e um circulo de raio `radius`.
 */
export const STEP_UP = 0.3;     // sobe sozinho degraus de ate 30 cm
export const BODY_H = 1.7;      // altura do corpo (cabeca livre abaixo de vigas/vergas)

/**
 * Altura do chao sob o jogador: topo de qualquer colisor em que ele pode pisar (degraus, caixas baixas,
 * plataformas, lajes, elevadores). So conta o que esta no maximo STEP_UP acima dos pes.
 */
export function groundHeight(x, z, y, colliders) {
  let g = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.maxY <= g) continue;
    if (y < c.maxY - STEP_UP) continue;
    let inside;
    if (c.circle) { const dx = x - c.x; const dz = z - c.z; inside = dx * dx + dz * dz < (c.r + 0.05) * (c.r + 0.05); }
    else inside = x > c.minX - 0.05 && x < c.maxX + 0.05 && z > c.minZ - 0.05 && z < c.maxZ + 0.05;
    if (inside) g = c.maxY;
  }
  return g;
}

export function resolveMovement(pos, radius, colliders, iterations = 4, y = 0) {
  let any = false;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (pos.x < c.minX - radius || pos.x > c.maxX + radius || pos.z < c.minZ - radius || pos.z > c.maxZ + radius) continue;
      if (y >= c.maxY - STEP_UP) continue;         // pisando em cima / passando por cima
      if (y + BODY_H <= c.minY) continue;          // passando por baixo (viga, verga)
      if (c.circle) {
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const min = radius + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const push = min - d;
            pos.x += (dx / d) * push;
            pos.z += (dz / d) * push;
          } else {
            pos.x += min;
          }
          moved = true;
        }
      } else {
        const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
        const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2);
            const push = radius - d;
            pos.x += (dx / d) * push;
            pos.z += (dz / d) * push;
          } else {
            // centro dentro da caixa: sai pela face mais proxima
            const l = pos.x - c.minX;
            const r = c.maxX - pos.x;
            const t = pos.z - c.minZ;
            const b = c.maxZ - pos.z;
            const m = Math.min(l, r, t, b);
            if (m === l) pos.x = c.minX - radius;
            else if (m === r) pos.x = c.maxX + radius;
            else if (m === t) pos.z = c.minZ - radius;
            else pos.z = c.maxZ + radius;
          }
          moved = true;
        }
      }
    }
    if (!moved) break;
    any = true;
  }
  return any;
}

/** Interseccao raio x caixa (metodo das lajes). Retorna a distancia t ou Infinity. */
export function rayAABB(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;

  if (Math.abs(dx) < 1e-9) {
    if (ox < b.minX || ox > b.maxX) return Infinity;
  } else {
    let t1 = (b.minX - ox) / dx;
    let t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.minY || oy > b.maxY) return Infinity;
  } else {
    let t1 = (b.minY - oy) / dy;
    let t2 = (b.maxY - oy) / dy;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < b.minZ || oz > b.maxZ) return Infinity;
  } else {
    let t1 = (b.minZ - oz) / dz;
    let t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

/**
 * Raio de TIRO: como rayBoxes, mas ignora colisores marcados `noShoot` (alvos e barris, que tem acerto proprio)
 * e devolve { t, box } da primeira parede/estrutura/gelo no caminho (ou null). Origem dentro de uma caixa nao conta.
 */
export function rayShot(ox, oy, oz, dx, dy, dz, maxDist, boxes) {
  let best = Infinity;
  let hit = null;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.noShoot) continue;
    let t = rayAABB(ox, oy, oz, dx, dy, dz, b);
    // origem DENTRO do colisor (cano encostado/enfiado na parede): a bala nao sai, bate na hora
    if (t <= 0.001 && oy >= b.minY && oy <= b.maxY) {
      const inside = b.circle ? ((ox - b.x) * (ox - b.x) + (oz - b.z) * (oz - b.z) < b.r * b.r)
        : (ox > b.minX && ox < b.maxX && oz > b.minZ && oz < b.maxZ);
      if (inside) t = 0.002;
    }
    if (t < best && t > 0.001) { best = t; hit = b; }
  }
  return best <= maxDist ? { t: best, box: hit } : null;
}

/** Menor distancia ate qualquer caixa ao longo do raio (direcao normalizada). Infinity se livre ate maxDist. */
export function rayBoxes(ox, oy, oz, dx, dy, dz, maxDist, boxes) {
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, boxes[i]);
    if (t < best) best = t;
  }
  return best <= maxDist ? best : Infinity;
}
