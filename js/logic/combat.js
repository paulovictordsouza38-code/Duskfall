// Regras de combate: vida (HP), vida extra (EP), itens, mochila, queda e explosoes. Modulo puro, testavel no Node.

export const HP_MAX = 200;
export const EP_MAX = 100;
export const EP_ASSIST_HP = 70;          // abaixo disso, o EP passa a reabastecer a vida
export const EP_ASSIST_TO = 100;         // ... ate a vida chegar a este valor
export const EP_ASSIST_RATE = 16;        // pontos por segundo
export const BANDAGE_EP = 50;            // 2 ataduras enchem o EP
export const USE_TIME = Object.freeze({ bandage: 1.4, medkit: 3.2 });
export const ITEM_CAP = Object.freeze({ bandage: 10, medkit: 4, frag: 5, gel: 4 });
export const ITEM_NAMES = Object.freeze({ bandage: 'Atadura', medkit: 'Kit médico', frag: 'Granada', gel: 'Granada de gel' });

export class Vitals {
  constructor() { this.reset(); }
  reset() { this.hp = HP_MAX; this.ep = 0; this.alive = true; }
  get dead() { return this.hp <= 0; }

  /** Dano direto na vida. Retorna true se morreu agora. */
  damage(n) {
    if (!this.alive || n <= 0) return false;
    this.hp = Math.max(0, this.hp - n);
    if (this.hp <= 0) { this.alive = false; return true; }
    return false;
  }

  /** O EP reabastece a vida quando ela esta acabando. */
  update(dt) {
    if (!this.alive) return;
    if (this.ep > 0 && this.hp < EP_ASSIST_HP + 0.0001 && this.hp > 0) this._assist = true;
    if (this._assist) {
      if (this.ep <= 0 || this.hp >= EP_ASSIST_TO || this.hp >= HP_MAX) { this._assist = false; return; }
      const t = Math.min(this.ep, EP_ASSIST_RATE * dt, EP_ASSIST_TO - this.hp);
      this.hp += t; this.ep -= t;
    }
  }

  get needsBandage() { return this.ep < EP_MAX - 0.01; }
  get needsMedkit() { return this.hp < HP_MAX - 0.01 && this.alive; }
  addBandage() { this.ep = Math.min(EP_MAX, this.ep + BANDAGE_EP); }
  addMedkit() { this.hp = HP_MAX; }
}

/** Mochila: contagem de itens (limitada) + mira 4x. */
export class Backpack {
  constructor() { this.reset(); }
  reset() { this.n = { bandage: 0, medkit: 0, frag: 0, gel: 0 }; this.scope4x = false; }
  add(kind, k = 1) {
    const cap = ITEM_CAP[kind];
    const before = this.n[kind];
    this.n[kind] = Math.min(cap, before + k);
    return this.n[kind] - before;
  }
  take(kind, k = 1) { if (this.n[kind] < k) return false; this.n[kind] -= k; return true; }
  get total() { return this.n.bandage + this.n.medkit + this.n.frag + this.n.gel + (this.scope4x ? 1 : 0); }
}

/** Dano de queda. Sem dano ate 2,5 m; cresce ate matar (HP_MAX) em `lethalH` metros. */
export function fallDamage(h, lethalH) {
  if (h <= 2.5) return 0;
  const t = Math.min(1.25, (h - 2.5) / Math.max(1, lethalH - 2.5));
  return Math.round(HP_MAX * Math.pow(t, 1.15));
}

/** Dano de explosao: maximo no centro, cai ate zero na borda. Nunca passa de `max`. */
export function explosionDamage(dist, radius, max) {
  if (dist >= radius) return 0;
  const t = 1 - dist / radius;
  return Math.round(max * (0.25 + 0.75 * t * t));
}

/** Tiro: dano da arma com bonus de cabeca. */
export function shotDamage(baseDmg, zone) {
  return Math.round(baseDmg * (zone === 'cabeca' ? 2 : 1));
}

/** Cilindro (corpo) e esfera (cabeca) de um jogador: devolve { t, zone } do raio ou null. */
export function rayVsPlayer(ox, oy, oz, dx, dy, dz, px, py, pz, maxDist, crouch = 0) {
  const H = 1.8 - 0.5 * crouch;
  const R = 0.36;
  // cabeca: esfera
  const hy = py + H - 0.17;
  let best = null;
  {
    const cx = px - ox, cy = hy - oy, cz = pz - oz;
    const b = cx * dx + cy * dy + cz * dz;
    const c = cx * cx + cy * cy + cz * cz - 0.2 * 0.2;
    const disc = b * b - c;
    if (disc >= 0) { const t = b - Math.sqrt(disc); if (t > 0 && t < maxDist) best = { t, zone: 'cabeca' }; }
  }
  // corpo: cilindro vertical
  const ax = ox - px, az = oz - pz;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = ax * dx + az * dz;
    const c = ax * ax + az * az - R * R;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t > 0 && t < maxDist && y >= py && y <= py + H && (!best || t < best.t)) best = { t, zone: y > py + H - 0.36 ? 'cabeca' : y > py + H * 0.62 ? 'peito' : 'corpo' };
    }
  }
  return best;
}
