// Pontuacao e estatisticas do treino. Modulo puro, testavel no Node.

// Dimensoes das silhuetas (metros, no referencial do alvo; origem no chao, centro em x=0)
export const SIL = Object.freeze({
  baseY: 0.30,
  torsoTop: 1.40,
  neckTop: 1.46,
  headCenterY: 1.60,
  headR: 0.13,
  halfShoulder: 0.28,
  halfWaist: 0.22,
});

export const PLATE = Object.freeze({ r: 0.20, bullseyeR: 0.07 });

/**
 * Pontos de um impacto. (lx, ly) = ponto de impacto no referencial local do alvo.
 * @returns {{zone:string, points:number}}
 */
export function scoreHit(kind, lx, ly) {
  if (kind === 'plate') {
    const r = Math.hypot(lx, ly);
    if (r <= PLATE.bullseyeR) return { zone: 'centro', points: 100 };
    return { zone: 'placa', points: 60 };
  }
  // silhueta
  if (ly >= SIL.neckTop - 0.01) return { zone: 'cabeca', points: 100 };
  if (Math.abs(lx) <= 0.18 && ly >= 0.80 && ly <= SIL.torsoTop) return { zone: 'centro', points: 75 };
  return { zone: 'tronco', points: 50 };
}

export class Stats {
  constructor() { this.reset(); }

  reset() {
    this.shots = 0;
    this.hits = 0;
    this.score = 0;
    this.lastZone = '';
  }

  registerShot() { this.shots += 1; }

  registerHit(points, zone = '') {
    this.hits += 1;
    this.score += points;
    this.lastZone = zone;
  }

  get misses() { return this.shots - this.hits; }

  get accuracy() {
    return this.shots > 0 ? Math.round((this.hits / this.shots) * 1000) / 10 : 0;
  }
}
