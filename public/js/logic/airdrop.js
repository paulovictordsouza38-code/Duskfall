// Queda livre e paraquedas (sem Three.js, testavel no Node). Mesmas regras para o jogador, bots e jogadores online.
export const DROP = {
  ALT: 300,            // altura do helicoptero (m)
  HELI_SPEED: 12,      // velocidade do helicoptero (m/s)
  HELI_Z0: -8, HELI_Z1: -312,
  FALL_V: 20,          // velocidade maxima da queda livre (m/s)
  FALL_A: 14,          // aceleracao ate la
  CHUTE_V: 4,          // velocidade da descida com paraquedas aberto
  CHUTE_BRAKE: 18,     // desaceleracao ao abrir
  OPEN_H: 70,          // abre sozinho a esta altura sobre o chao
  H_FALL: 9, H_CHUTE: 7,   // controle horizontal (m/s)
};

// cabine (metros, relativo ao centro do helicoptero) e lugares onde cada um fica em pe antes de pular
export const CABIN = { W: 1.6, L: 3.2, H: 2.8 };
export const SLOTS = [[1.0, 0.5], [1.0, -0.9], [1.0, 1.9], [1.0, -2.2], [1.0, 3.0], [0.2, 1.2], [0.2, -0.2], [0.2, -1.6], [0.2, 2.6], [0.2, -2.6]]
  .map(([x, z]) => ({ x, z }));
export function slotFor(id) {                 // online: mesmo lugar em todas as telas, a partir do id
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SLOTS[h % SLOTS.length];
}

export function newDrop(x, y, z) {
  return { phase: 'fall', x, y, z, vy: 0, vx: 0, vz: 0, open: 0, t: 0, auto: false };
}

/** abre o paraquedas (uma vez) */
export function openChute(d, auto = false) {
  if (d.phase !== 'fall') return false;
  d.phase = 'chute'; d.auto = auto; return true;
}

/**
 * Avanca a descida. gY = altura do chao embaixo; (mx, mz) = direcao desejada no mundo (modulo <= 1).
 * Devolve true ao pousar. Nao ha dano de queda: quem chama simplesmente encerra a fase.
 */
export function stepDrop(d, dt, gY, mx, mz, openAt = DROP.OPEN_H) {
  d.t += dt;
  if (d.phase === 'fall' && d.y - gY <= openAt) openChute(d, true);
  if (d.phase === 'fall') d.vy = Math.max(-DROP.FALL_V, d.vy - DROP.FALL_A * dt);
  else d.vy = Math.min(-DROP.CHUTE_V, d.vy + DROP.CHUTE_BRAKE * dt);          // freia ate a velocidade do paraquedas
  if (d.phase === 'chute') d.open = Math.min(1, d.open + dt / 0.7);
  const sp = d.phase === 'fall' ? DROP.H_FALL : DROP.H_CHUTE;
  const k = Math.min(1, 4 * dt);
  d.vx += (mx * sp - d.vx) * k; d.vz += (mz * sp - d.vz) * k;
  d.x += d.vx * dt; d.z += d.vz * dt;
  d.y += d.vy * dt;
  if (d.y <= gY) { d.y = gY; d.vy = 0; d.phase = 'landed'; return true; }
  return false;
}

/** posicao do helicoptero t segundos apos o inicio */
export function heliAt(t) {
  const z = DROP.HELI_Z0 - DROP.HELI_SPEED * t;
  return { x: 0, y: DROP.ALT, z: Math.max(DROP.HELI_Z1, z), end: z <= DROP.HELI_Z1 };
}
