// DUSKFALL ISLAND - ponto de entrada do mapa. Junta amostrador de altura, terreno, agua, luz e neblina.
// Independente do main.js e do cenario atual: o jogo antigo continua intacto.
import * as THREE from 'three';
import { TerrainHeightSampler } from './TerrainHeightSampler.js';
import { TerrainManager } from './TerrainManager.js';

export class IslandWorld {
  constructor(scene, cfg) {
    this.scene = scene; this.cfg = cfg;
    this.sampler = new TerrainHeightSampler(cfg);
    this.terrain = new TerrainManager(scene, this.sampler, cfg);
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
    await this.terrain.buildAll(onProgress);
  }

  /** Altura do chao no ponto. A Fase 5 liga isto ao groundHeight() dos colisores atuais. */
  groundHeight(x, z) { return this.sampler.height(x, z); }

  update(camPos) {
    this.water.position.x = camPos.x; this.water.position.z = camPos.z;
    return this.terrain.update(camPos, this.cfg.viewDistance);
  }

  dispose() { this.terrain.dispose(); this.scene.remove(this.root); }
}
