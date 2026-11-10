// DUSKFALL ISLAND - ponto de entrada do mapa. Junta amostrador de altura, terreno, agua, luz e neblina.
// Independente do main.js e do cenario atual: o jogo antigo continua intacto.
import * as THREE from 'three';
import { TerrainHeightSampler } from './TerrainHeightSampler.js';
import { TerrainManager } from './TerrainManager.js';
import { ChunkManager } from './ChunkManager.js';
import { MapStreaming } from './MapStreaming.js';

export class IslandWorld {
  constructor(scene, cfg) {
    this.scene = scene; this.cfg = cfg;
    this.sampler = new TerrainHeightSampler(cfg);
    this.terrain = new TerrainManager(scene, this.sampler, cfg);
    this.chunks = new ChunkManager({
      grid: cfg.grid,
      factory: { build: (ix, iz) => this.terrain.buildChunk(ix, iz), release: (ix, iz, m) => this.terrain.releaseChunk(ix, iz, m) },
      maxLoaded: cfg.maxLoaded || 36, maxPerFrame: cfg.maxPerFrame || 1, budgetMs: cfg.budgetMs || 4,
    });
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
    while (this.chunks.pending > 0) {
      this.chunks.tick();
      if (onProgress) onProgress(Math.min(1, this.chunks.loaded / Math.max(1, total)));
      await new Promise((r) => setTimeout(r, 0));
    }
    if (onProgress) onProgress(1);
  }

  /** Altura do chao no ponto. A Fase 5 liga isto ao groundHeight() dos colisores atuais. */
  groundHeight(x, z) { return this.sampler.height(x, z); }

  update(camPos) {
    this.water.position.x = camPos.x; this.water.position.z = camPos.z;
    return this.streaming.update(camPos.x, camPos.z);
  }

  /** Jogadores, tiros e sistemas ativos: o setor onde estao nao e descarregado. */
  track(id, x, z) { this.streaming.track(id, x, z); }
  untrack(id) { this.streaming.untrack(id); }
  stats() { const s = this.streaming.stats(); s.poolFree = this.terrain.pool.length; s.created = this.terrain.created; s.mb = this.terrain.memoryMB(); return s; }

  dispose() { this.chunks.dispose(); this.terrain.dispose(); this.scene.remove(this.root); }
}
