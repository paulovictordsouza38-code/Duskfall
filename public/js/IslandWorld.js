// DUSKFALL ISLAND - ponto de entrada do mapa. Junta amostrador de altura, terreno, agua, luz e neblina.
// Independente do main.js e do cenario atual: o jogo antigo continua intacto.
import * as THREE from 'three';
import { TerrainHeightSampler } from './TerrainHeightSampler.js';
import { TerrainManager } from './TerrainManager.js';
import { ChunkManager } from './ChunkManager.js';
import { MapStreaming } from './MapStreaming.js';
import { PropsManager } from './PropsManager.js';

export class IslandWorld {
  constructor(scene, cfg) {
    this.scene = scene; this.cfg = cfg;
    this.sampler = new TerrainHeightSampler(cfg);
    this.terrain = new TerrainManager(scene, this.sampler, cfg);
    this.chunks = new ChunkManager({
      grid: cfg.grid,
      factory: {
        // terreno agora; objetos (arvores, rochas, predios) entram na fila e sao feitos 1 por quadro, para nao somar tempo no mesmo quadro
        build: (ix, iz) => { const item = { mesh: this.terrain.buildChunk(ix, iz), props: null, ix, iz }; this.propQueue.push(item); return item; },
        release: (ix, iz, item) => {
          this.terrain.releaseChunk(ix, iz, item.mesh);
          if (item.props) this.props.releaseSector(item.props); else { const i = this.propQueue.indexOf(item); if (i >= 0) this.propQueue.splice(i, 1); }
        },
      },
      maxLoaded: cfg.maxLoaded || 36, maxPerFrame: cfg.maxPerFrame || 1, budgetMs: cfg.budgetMs || 4,
    });
    this.props = new PropsManager(scene, this.sampler, cfg); this.propQueue = []; this.propStats = { n: 0, sum: 0, max: 0 };
    this.streaming = new MapStreaming(this.chunks, { grid: cfg.grid, size: cfg.size, viewDistance: cfg.viewDistance });
    this.mapVersion = cfg.mapVersion;
    this.root = new THREE.Group(); this.root.name = 'ilha';
    scene.add(this.root);
  }

  async build(onProgress) {
    const sky = 0xbcd9f2;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 70, this.cfg.viewDistance);
    const hemi = new THREE.HemisphereLight(0xdcecff, 0x7a7058, 1.0);
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.1); sun.position.set(-120, 200, -80);
    this.root.add(hemi, sun);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ color: 0x2f7ea6, transparent: true, opacity: 0.82 }),
    );
    water.rotation.x = -Math.PI / 2; water.position.y = this.sampler.sea - 0.05;
    this.water = water; this.root.add(water);
  }

  /** Carrega os setores em volta de (x,z) ANTES de comecar (tela de carregamento). */
  async preload(x, z, onProgress) {
    this.streaming.update(x, z, true);
    const total = this.chunks.pending + this.chunks.loaded;
    while (this.chunks.pending > 0 || this.propQueue.length > 0) {
      this.chunks.tick(); this._propTick();
      if (onProgress) onProgress(Math.min(1, this.chunks.loaded / Math.max(1, total)));
      await new Promise((r) => setTimeout(r, 0));
    }
    this.chunks.resetPeak(); this.propStats.n = 0; this.propStats.sum = 0; this.propStats.max = 0;
    if (onProgress) onProgress(1);
  }

  /** Altura do chao no ponto. A Fase 5 liga isto ao groundHeight() dos colisores atuais. */
  groundHeight(x, z) { return this.sampler.height(x, z); }

  update(camPos) {
    this.water.position.x = camPos.x; this.water.position.z = camPos.z;
    const n = this.streaming.update(camPos.x, camPos.z);
    this._propTick();
    return n;
  }

  _propTick() {
    const it = this.propQueue.shift();
    if (!it || it.props) return;
    const t = performance.now();
    it.props = this.props.buildSector(it.ix, it.iz);
    const ms = performance.now() - t; const ps = this.propStats;
    ps.n++; ps.sum += ms; if (ms > ps.max) ps.max = ms;
  }

  /** Jogadores, tiros e sistemas ativos: o setor onde estao nao e descarregado. */
  track(id, x, z) { this.streaming.track(id, x, z); }
  untrack(id) { this.streaming.untrack(id); }
  stats() { const s = this.streaming.stats(); s.poolFree = this.terrain.pool.length; s.created = this.terrain.created; s.mb = this.terrain.memoryMB(); s.props = this.props.live; s.propAvg = this.propStats.n ? this.propStats.sum / this.propStats.n : 0; s.propMax = this.propStats.max; return s; }

  dispose() { this.chunks.dispose(); this.props.dispose(); this.terrain.dispose(); this.scene.remove(this.root); }
}
