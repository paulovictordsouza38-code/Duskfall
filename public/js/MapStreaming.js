// DUSKFALL ISLAND - decide QUAIS setores devem existir em volta do jogador e comanda o ChunkManager. PURO (sem Three.js).
//  * carrega quem esta dentro de viewDistance + margem (alem da neblina: a entrada do setor nao aparece);
//  * pre-carrega os 8 vizinhos do setor atual com prioridade maxima;
//  * so descarrega depois de sair de uma distancia maior (histerese: andar na borda nao fica carregando e descarregando);
//  * setores com jogadores/tiros/sistemas ativos (track) ficam retidos.
export class MapStreaming {
  constructor(chunks, { grid, size, viewDistance, margin = 40 }) {
    this.chunks = chunks; this.grid = grid; this.size = size; this.sector = size / grid; this.half = size / 2;
    this.viewDistance = viewDistance; this.margin = margin;
    this.cx = -1; this.cz = -1; this.lastKeyCount = 0;
    this.capped = 0;
  }
  sectorOf(x, z) {
    const ix = Math.floor((x + this.half) / this.sector); const iz = Math.floor((z + this.half) / this.sector);
    return { ix: Math.max(0, Math.min(this.grid - 1, ix)), iz: Math.max(0, Math.min(this.grid - 1, iz)) };
  }
  /** Menor distancia (planta baixa) do ponto ao retangulo do setor. */
  distTo(x, z, ix, iz) {
    const x0 = -this.half + ix * this.sector; const z0 = -this.half + iz * this.sector;
    const dx = Math.max(x0 - x, 0, x - (x0 + this.sector)); const dz = Math.max(z0 - z, 0, z - (z0 + this.sector));
    return Math.hypot(dx, dz);
  }

  /** Jogador/camera em (x,z). Recalcula so quando muda de setor (ou force). */
  update(x, z, force = false) {
    const s = this.sectorOf(x, z);
    const moved = s.ix !== this.cx || s.iz !== this.cz;
    if (moved || force) {
      this.cx = s.ix; this.cz = s.iz;
      this.chunks.ensure(s.ix, s.iz);                              // o chao sob o jogador nunca falta
      const loadR = this.viewDistance + this.margin; const keepR = loadR + this.sector;
      const load = []; const keep = new Set();
      for (let iz = 0; iz < this.grid; iz++) for (let ix = 0; ix < this.grid; ix++) {
        const d = this.distTo(x, z, ix, iz); const k = this.chunks.key(ix, iz);
        const near = Math.abs(ix - s.ix) <= 1 && Math.abs(iz - s.iz) <= 1;   // vizinhos: pre-carga
        if (near) load.push({ k, d: -1 + d * 1e-6 });
        else if (d <= loadR) load.push({ k, d });
        if (near || d <= keepR) keep.add(k);
      }
      load.sort((a, b) => a.d - b.d);
      let keys = load.map((o) => o.k);
      this.capped = 0;
      if (keys.length > this.chunks.maxLoaded) { this.capped = keys.length - this.chunks.maxLoaded; keys = keys.slice(0, this.chunks.maxLoaded); }
      const keepCapped = new Set(keys); for (const k of keep) if (this.chunks.items.has(k) && keepCapped.size < this.chunks.maxLoaded) keepCapped.add(k);
      this.chunks.sync(keys, keepCapped);
    }
    return this.chunks.tick();
  }

  /** Marca um jogador / tiro / sistema ativo: o setor onde ele esta fica retido (nao descarrega). */
  track(id, x, z) { const s = this.sectorOf(x, z); this.chunks.retain(id, s.ix, s.iz); }
  untrack(id) { this.chunks.release(id); }

  stats() { return { loaded: this.chunks.loaded, pending: this.chunks.pending, builds: this.chunks.stats.builds, unloads: this.chunks.stats.unloads, maxMs: this.chunks.stats.maxMs, capped: this.capped, retained: this.chunks.retainers.size, cx: this.cx, cz: this.cz }; }
}
