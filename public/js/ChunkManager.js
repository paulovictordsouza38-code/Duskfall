// DUSKFALL ISLAND - gerenciador de setores (PURO, sem Three.js: testavel no Node).
// Guarda o estado de cada setor (descarregado / na fila / carregado), controla quantos sao construidos por quadro
// (orcamento de tempo), nunca descarrega setor "retido" (jogador, tiro, sistema ativo) e limita a memoria (maxLoaded).
// A construcao real fica numa fabrica: factory.build(ix, iz) -> item, factory.release(ix, iz, item).

export class ChunkManager {
  constructor({ grid, factory, maxLoaded = 36, maxPerFrame = 1, budgetMs = 4, now = () => performance.now() }) {
    this.grid = grid; this.factory = factory;
    this.maxLoaded = maxLoaded; this.maxPerFrame = maxPerFrame; this.budgetMs = budgetMs; this.now = now;
    this.items = new Map();          // key -> item carregado
    this.queue = [];                 // keys a construir, mais urgente primeiro
    this.retainers = new Map();      // dono -> key
    this.keep = new Set();           // keys que nao devem ser descarregadas agora
    this.stats = { builds: 0, unloads: 0, lastMs: 0, maxMs: 0, deferred: 0, sumMs: 0, n: 0 };
  }
  key(ix, iz) { return iz * this.grid + ix; }
  ix(k) { return k % this.grid; }
  iz(k) { return (k / this.grid) | 0; }
  valid(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.grid && iz < this.grid; }
  isLoaded(ix, iz) { return this.items.has(this.key(ix, iz)); }
  get(ix, iz) { return this.items.get(this.key(ix, iz)); }
  get loaded() { return this.items.size; }

  /** Retem o setor de um dono (jogador, tiro...). Setor retido nao e descarregado e entra na fila com prioridade. */
  retain(owner, ix, iz) {
    if (!this.valid(ix, iz)) { this.release(owner); return; }
    const k = this.key(ix, iz);
    if (this.retainers.get(owner) === k) return;
    this.retainers.set(owner, k);
    if (!this.items.has(k) && !this.queue.includes(k)) this.queue.unshift(k);
  }
  release(owner) { this.retainers.delete(owner); }
  retainedKeys() { return new Set(this.retainers.values()); }

  /** Constroi agora (sincrono). Para o setor sob o jogador, que nao pode faltar. */
  ensure(ix, iz) {
    if (!this.valid(ix, iz)) return null;
    const k = this.key(ix, iz);
    if (this.items.has(k)) return this.items.get(k);
    const t = this.now();
    const item = this.factory.build(ix, iz);
    this.items.set(k, item);
    this.stats.builds++;
    const ms = this.now() - t; this.stats.lastMs = ms; this.stats.sumMs += ms; this.stats.n++; if (ms > this.stats.maxMs) this.stats.maxMs = ms;
    return item;
  }

  unload(k) {
    const item = this.items.get(k);
    if (item === undefined) return;
    this.items.delete(k);
    this.factory.release(this.ix(k), this.iz(k), item);
    this.stats.unloads++;
  }

  /**
   * load: keys desejadas, da mais perto para a mais longe. keep: keys que podem ficar carregadas (inclui margem de histerese).
   * Descarrega o que saiu de `keep` (menos os retidos) e remonta a fila.
   */
  sync(load, keep) {
    this.keep = keep;
    const held = this.retainedKeys();
    for (const k of [...this.items.keys()]) if (!keep.has(k) && !held.has(k)) this.unload(k);
    const q = []; const seen = new Set();
    for (const k of held) if (!this.items.has(k)) { q.push(k); seen.add(k); }
    for (const k of load) if (!this.items.has(k) && !seen.has(k)) { q.push(k); seen.add(k); }
    this.queue = q;
    // limite de memoria: se passou, descarrega os mais longe (ultimos de `load`) que nao estao retidos
    if (this.items.size > this.maxLoaded) {
      const order = [...this.items.keys()];
      const rank = new Map(); load.forEach((k, i) => rank.set(k, i));
      order.sort((a, b) => (rank.has(b) ? rank.get(b) : 1e9) - (rank.has(a) ? rank.get(a) : 1e9));
      for (const k of order) { if (this.items.size <= this.maxLoaded) break; if (!held.has(k)) this.unload(k); }
    }
  }

  /** Chamar uma vez por quadro: constroi da fila respeitando maxPerFrame e o orcamento de tempo. */
  tick() {
    const t0 = this.now(); let n = 0;
    while (this.queue.length && n < this.maxPerFrame) {
      if (n > 0 && this.now() - t0 > this.budgetMs) break;
      if (this.items.size >= this.maxLoaded && !this.retainedKeys().has(this.queue[0])) { this.stats.deferred++; this.queue.length = 0; break; }
      const k = this.queue.shift();
      if (this.items.has(k)) continue;
      this.ensure(this.ix(k), this.iz(k)); n++;
    }
    return n;
  }
  get pending() { return this.queue.length; }
  /** Zera media e pior caso (chamar depois da carga inicial, que e a mais lenta). */
  resetPeak() { this.stats.maxMs = 0; this.stats.sumMs = 0; this.stats.n = 0; }

  dispose() { for (const k of [...this.items.keys()]) this.unload(k); this.queue.length = 0; this.retainers.clear(); }
}
