// Regras das armas. Modulo puro, testavel no Node.
// Municao: 'short' (pistolas e submetralhadoras) e 'long' (fuzis e sniper).

export const WEAPON_IDS = Object.freeze(['usp', 'g18', 'mp40', 'mp5', 'xm8', 'famas', 'scar', 'awm']);

const W = (o) => Object.freeze({ dmg: 20, range: 300, spreadHip: 0.016, zoom: 1, scope4: false, ...o });

export const WEAPONS = Object.freeze({
  usp: W({
    id: 'usp', name: 'USP', label: 'USP .45', slot: 1, ammo: 'short', kind: 'pistol',
    magSize: 18, reserve: 54, maxReserve: 144, pickupAmmo: 36,
    auto: false, interval: 0.15, reloadTime: 1.26, drawTime: 0.19,
    recoilPitch: 0.020, recoilKick: 0.55, spreadAim: 0.0018, spreadHip: 0.010, damage: 1.0, range: 220,
    dmg: 30,
  }),
  g18: W({
    id: 'g18', name: 'G18', label: 'G18 9mm (rajada)', slot: 2, ammo: 'short', kind: 'pistol',
    magSize: 50, reserve: 150, maxReserve: 450, pickupAmmo: 100,
    auto: true, interval: 0.058, reloadTime: 1.37, drawTime: 0.17,
    recoilPitch: 0.0125, recoilKick: 0.4, spreadAim: 0.0035, spreadHip: 0.016, damage: 0.55, range: 200,
    dmg: 15,
  }),
  mp40: W({
    id: 'mp40', name: 'MP40', label: 'MP40 9mm', slot: 3, ammo: 'short', kind: 'smg',
    magSize: 90, reserve: 270, maxReserve: 720, pickupAmmo: 135,
    auto: true, interval: 0.12, reloadTime: 1.69, drawTime: 0.28,
    recoilPitch: 0.0095, recoilKick: 0.32, spreadAim: 0.0040, spreadHip: 0.018, damage: 0.65, range: 220,
    dmg: 17,
  }),
  mp5: W({
    id: 'mp5', name: 'MP5', label: 'MP5 9mm', slot: 4, ammo: 'short', kind: 'smg',
    magSize: 45, reserve: 180, maxReserve: 540, pickupAmmo: 90,
    auto: true, interval: 0.075, reloadTime: 1.51, drawTime: 0.25,
    recoilPitch: 0.0075, recoilKick: 0.26, spreadAim: 0.0028, spreadHip: 0.015, damage: 0.7, range: 240,
    dmg: 19,
  }),
  xm8: W({
    id: 'xm8', name: 'XM8', label: 'XM8 5.56 • mira 2x', slot: 5, ammo: 'long', kind: 'rifle',
    magSize: 45, reserve: 180, maxReserve: 450, pickupAmmo: 90, zoom: 2,
    auto: true, interval: 0.083, reloadTime: 1.66, drawTime: 0.3,
    recoilPitch: 0.0105, recoilKick: 0.34, spreadAim: 0.0016, spreadHip: 0.020, damage: 0.95, range: 320,
    dmg: 25,
  }),
  famas: W({
    id: 'famas', name: 'FAMAS', label: 'FAMAS 5.56 • mira 2x', slot: 6, ammo: 'long', kind: 'rifle',
    magSize: 40, reserve: 160, maxReserve: 400, pickupAmmo: 80, zoom: 2, scope4: true,
    auto: true, interval: 0.056, reloadTime: 1.8, drawTime: 0.3,
    recoilPitch: 0.0125, recoilKick: 0.36, spreadAim: 0.0020, spreadHip: 0.020, damage: 0.8, range: 320,
    dmg: 21,
  }),
  scar: W({
    id: 'scar', name: 'SCAR', label: 'SCAR-H 7.62 • mira 2x', slot: 7, ammo: 'long', kind: 'rifle',
    magSize: 30, reserve: 120, maxReserve: 300, pickupAmmo: 60, zoom: 2, scope4: true,
    auto: true, interval: 0.1, reloadTime: 1.87, drawTime: 0.33,
    recoilPitch: 0.0165, recoilKick: 0.5, spreadAim: 0.0014, spreadHip: 0.022, damage: 1.35, range: 380,
    dmg: 36,
  }),
  awm: W({
    id: 'awm', name: 'AWM', label: 'AWM .338 • mira 8x', slot: 8, ammo: 'long', kind: 'sniper',
    magSize: 8, reserve: 24, maxReserve: 64, pickupAmmo: 16, zoom: 8,
    auto: false, interval: 1.2, reloadTime: 2.45, drawTime: 0.45,
    recoilPitch: 0.045, recoilKick: 1.0, spreadAim: 0.0001, spreadHip: 0.03, damage: 5, range: 500,
    dmg: 150,
  }),
});

/** Zoom efetivo da arma: mira embutida; FAMAS e SCAR passam a 4x com a mira 4x achada no mapa. */
export function zoomFor(id, has4x = false) {
  const c = WEAPONS[id];
  if (!c) return 1;
  return c.scope4 && has4x ? 4 : c.zoom;
}

export class WeaponState {
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.mag = this.cfg.magSize;
    this.reserve = this.cfg.reserve;
    this.clock = 0;
    this.nextShot = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.drawT = 0;
  }

  update(dt) {
    this.clock += dt;
    if (this.drawT > 0) this.drawT = Math.max(0, this.drawT - dt);
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= this.cfg.reloadTime) this._finishReload();
    }
  }

  _finishReload() {
    const need = this.cfg.magSize - this.mag;
    const take = Math.min(need, this.reserve);
    this.mag += take;
    this.reserve -= take;
    this.reloading = false;
    this.reloadT = 0;
  }

  /** Adiciona munição de reserva (limitada ao máximo). Retorna quanto realmente entrou. */
  addReserve(n) {
    const before = this.reserve;
    this.reserve = Math.min(this.cfg.maxReserve, this.reserve + n);
    return this.reserve - before;
  }

  get empty() { return this.mag <= 0 && this.reserve <= 0; }

  get reloadProgress() {
    return this.reloading ? Math.min(1, this.reloadT / this.cfg.reloadTime) : 0;
  }

  get ready() {
    return !this.reloading && this.drawT <= 0;
  }

  needsReload() {
    return this.mag < this.cfg.magSize && this.reserve > 0 && !this.reloading;
  }

  startReload() {
    if (this.drawT > 0 || !this.needsReload()) return false;
    this.reloading = true;
    this.reloadT = 0;
    return true;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadT = 0;
  }

  /**
   * Tenta disparar.
   * @param {boolean} held       gatilho mantido
   * @param {boolean} pressed    gatilho acabou de ser apertado (borda)
   * @returns {'fired'|'dry'|null}
   */
  tryFire(held, pressed) {
    const wants = held || pressed;   // segurar o botao = continua atirando ate soltar (todas as armas)
    if (!wants) return null;
    if (!this.ready) return null;
    if (this.clock < this.nextShot) return null;
    if (this.mag <= 0) return pressed ? 'dry' : null;
    this.mag -= 1;
    // acumula o intervalo para manter a cadencia estavel mesmo com quadros irregulares
    this.nextShot = Math.max(this.nextShot, this.clock - this.cfg.interval * 0.5) + this.cfg.interval;
    return 'fired';
  }
}

export class Loadout {
  constructor() {
    this.states = WEAPON_IDS.map((id) => new WeaponState(WEAPONS[id]));
    this.index = 0;
    this.owned = WEAPON_IDS.map((_, i) => i === 0);   // comeca so com a pistola; o resto se acha no mapa
    this.has4x = false;                               // mira 4x (so vale para FAMAS e SCAR)
  }

  get current() { return this.states[this.index]; }
  get currentId() { return WEAPON_IDS[this.index]; }
  get zoom() { return zoomFor(this.currentId, this.has4x); }

  /** Reinicia municao e posse. `all: true` libera todas as armas (testes/depuracao). */
  reset({ all = false } = {}) {
    this.states.forEach((s) => s.reset());
    this.index = 0;
    this.owned = WEAPON_IDS.map((_, i) => all || i === 0);
    this.has4x = false;
  }

  /**
   * Passa a possuir a arma `i`. Regra: no maximo UMA pistola e DUAS armas principais.
   * Retorna null se ja era sua; senao { dropped } com o indice da arma que teve de ser largada (ou -1).
   */
  /** Qual arma teria de ser largada se eu pegasse a `i`? null = ja e minha; -1 = nenhuma (cabe). (Usado na pre-visualizacao.) */
  wouldDrop(i) {
    if (!Number.isInteger(i) || i < 0 || i >= WEAPON_IDS.length || this.owned[i]) return null;
    const pistol = WEAPONS[WEAPON_IDS[i]].kind === 'pistol';
    const same = this.owned.map((o, k) => (o && (WEAPONS[WEAPON_IDS[k]].kind === 'pistol') === pistol ? k : -1)).filter((k) => k >= 0);
    if (pistol && same.length >= 1) return same[0];
    if (!pistol && same.length >= 2) return same.includes(this.index) ? this.index : same[0];
    return -1;
  }

  pickUp(i) {
    const dropped = this.wouldDrop(i);
    if (dropped === null) return null;
    if (dropped >= 0) {
      this.owned[dropped] = false;
      this.states[dropped].reset();
      if (this.index === dropped) this.index = i;     // a arma nova ja fica na mao
    }
    this.owned[i] = true;
    this.states[i].reset();
    return { dropped };
  }

  /** Larga a arma `i` (mochila). Retorna true se largou. A pistola inicial tambem pode ser largada. */
  discard(i) {
    if (!Number.isInteger(i) || !this.owned[i]) return false;
    this.owned[i] = false;
    this.states[i].reset();
    if (this.index === i) { const n = this.owned.findIndex(Boolean); this.index = n >= 0 ? n : 0; }
    return true;
  }

  get anyOwned() { return this.owned.some(Boolean); }

  /** Proxima arma possuida (para o botao de trocar). */
  nextOwned() {
    for (let k = 1; k <= WEAPON_IDS.length; k++) {
      const j = (this.index + k) % WEAPON_IDS.length;
      if (this.owned[j]) return j;
    }
    return this.index;
  }

  update(dt) {
    // apenas a arma em uso avanca (a guardada nao recarrega sozinha)
    this.current.update(dt);
  }

  /** Alterna para a arma `i`. Indice invalido ou arma nao possuida e ignorado. */
  switchTo(i) {
    if (!Number.isInteger(i) || i < 0 || i >= WEAPON_IDS.length) return false;
    if (i === this.index) return false;
    if (!this.owned[i]) return false;
    this.current.cancelReload();
    this.index = i;
    this.current.drawT = this.current.cfg.drawTime;
    return true;
  }

  /**
   * Caixa de municao. `kind`: 'short' | 'long' (so as armas daquele tipo) ou o id de uma arma (so ela);
   * sem argumento reabastece todas. Retorna o total que entrou.
   */
  addAmmo(kind) {
    let total = 0;
    for (const s of this.states) {
      if (kind && s.cfg.ammo !== kind && s.cfg.id !== kind) continue;
      total += s.addReserve(s.cfg.pickupAmmo);
    }
    return total;
  }

  toggle() {
    return this.switchTo(this.nextOwned());
  }
}
