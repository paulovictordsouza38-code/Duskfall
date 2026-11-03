// Alvos de treinamento: silhuetas de cartolina e placas de aco, fixos ou moveis.
import * as THREE from 'three';
import { scoreHit, SIL, PLATE } from './logic/scoring.js';

const UP = new THREE.Vector3(0, 1, 0);

function triangleWave(t) {
  // 0..1..0 com periodo 2
  const m = ((t % 2) + 2) % 2;
  return m < 1 ? m : 2 - m;
}

let silhouetteGeos = null;
function getSilhouetteGeos() {
  if (silhouetteGeos) return silhouetteGeos;
  const torso = new THREE.Shape();
  const pts = [
    [-0.22, 0.30], [0.22, 0.30], [0.26, 1.05], [0.28, 1.30], [0.20, 1.40], [0.07, 1.40], [0.06, 1.46],
    [-0.06, 1.46], [-0.07, 1.40], [-0.20, 1.40], [-0.28, 1.30], [-0.26, 1.05],
  ];
  torso.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) torso.lineTo(pts[i][0], pts[i][1]);
  torso.closePath();
  const head = new THREE.Shape();
  head.absarc(0, SIL.headCenterY, SIL.headR, 0, Math.PI * 2, false);

  const opts = { depth: 0.012, bevelEnabled: false, curveSegments: 20 };
  const gT = new THREE.ExtrudeGeometry(torso, opts);
  const gH = new THREE.ExtrudeGeometry(head, opts);
  for (const g of [gT, gH]) {
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) + 0.30) / 0.60, (pos.getY(i) - 0.30) / 1.46);
    }
    uv.needsUpdate = true;
  }
  silhouetteGeos = { torso: gT, head: gH };
  return silhouetteGeos;
}

export class Target {
  /**
   * @param {object} o
   * @param {'silhouette'|'plate'} o.kind
   * @param {number} o.x @param {number} o.z
   * @param {object} o.lib   biblioteca de texturas
   * @param {object} [o.move] { type:'pingpong', min, max, speed, phase } | { type:'sine', cx, amp, period, phase }
   */
  constructor({ kind, x, z, lib, mats, move = null, radius = PLATE.r }) {
    this.kind = kind;
    this.baseX = x;
    this.baseZ = z;
    this.move = move;
    this.moving = !!move;
    this.id = Target._next++;
    this.hits = 0;

    this.root = new THREE.Group();
    this.root.userData.dynamic = true;
    this.root.position.set(x, 0, z);
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);

    this.meshes = [];
    this.angle = 0;
    this.vel = 0;
    this.flash = 0;
    this.stiffness = kind === 'plate' ? 110 : 55;
    this.damping = kind === 'plate' ? 2.4 : 5.0;
    this.impulse = kind === 'plate' ? -2.6 : -3.4;
    this.minAngle = -1.6;
    this.down = false;
    this.downT = 0;
    this.riseT = 0;
    this.maxAngle = 0.2;
    this.plateRadius = radius;

    if (kind === 'silhouette') this._buildSilhouette(lib, mats);
    else this._buildPlate(lib, mats, radius);

    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.update(0, 0);
  }

  _buildSilhouette(lib, mats) {
    const g = getSilhouetteGeos();
    this.paper = new THREE.MeshStandardMaterial({
      map: lib.silhouettePaper(),
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const torso = new THREE.Mesh(g.torso, this.paper);
    const head = new THREE.Mesh(g.head, this.paper);
    for (const m of [torso, head]) {
      m.userData.target = this;
      this.pivot.add(m);
      this.meshes.push(m);
    }
    // suporte: duas hastes metalicas + sapata
    const legGeo = new THREE.CylinderGeometry(0.014, 0.014, SIL.baseY + 0.25, 8);
    for (const sx of [-0.14, 0.14]) {
      const leg = new THREE.Mesh(legGeo, mats.steel);
      leg.position.set(sx, (SIL.baseY + 0.25) / 2 - 0.0, -0.012);
      this.pivot.add(leg);
    }
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.02, 0.16), mats.steel);
    foot.position.set(0, 0.01, -0.02);
    this.pivot.add(foot);
  }

  _buildPlate(lib, mats, radius) {
    const mat = new THREE.MeshStandardMaterial({
      map: lib.steelPlate(),
      roughness: 0.45,
      metalness: 0.55,
    });
    this.paper = mat;
    this.pivot.position.y = 1.35;
    const geo = new THREE.CylinderGeometry(radius, radius, 0.025, 40, 1);
    geo.rotateX(Math.PI / 2);
    const plate = new THREE.Mesh(geo, mat);
    plate.userData.target = this;
    this.pivot.add(plate);
    this.meshes.push(plate);
    // haste, base e dobradica (nao balancam com a placa)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.35, 10), mats.steel);
    pole.position.set(0, 0.675, -0.05);
    this.root.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 20), mats.steel);
    base.position.set(0, 0.015, -0.05);
    this.root.add(base);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.05), mats.steel);
    arm.position.set(0, 1.35 + radius + 0.01, -0.03);
    this.root.add(arm);
  }

  /** Posicao de impacto no referencial do alvo + pontuacao. Chamar ANTES de aplicar a reacao. */
  evaluate(worldPoint, tmp = new THREE.Vector3()) {
    tmp.copy(worldPoint);
    this.pivot.worldToLocal(tmp);
    return scoreHit(this.kind, tmp.x, tmp.y);
  }

  get isDown() { return this.down; }

  /** Tiro na cabeca derruba a silhueta (levanta sozinha depois de alguns segundos). */
  onHit(strength = 1, zone = '') {
    this.hits += 1;
    this.flash = 1;
    if (this.kind === 'silhouette' && zone === 'cabeca' && !this.down) {
      this.down = true;
      this.downT = 3.2;
      this.vel = -3.2;
      return true;
    }
    this.vel += this.impulse * strength;
    return false;
  }

  reset() {
    this.angle = 0;
    this.vel = 0;
    this.flash = 0;
    this.hits = 0;
    this.down = false;
    this.downT = 0;
    this.riseT = 0;
    this.pivot.rotation.x = 0;
    this.paper.emissive.setRGB(0, 0, 0);
    this.update(0, 0);
  }

  update(dt, time) {
    if (this.move) {
      const m = this.move;
      if (m.type === 'pingpong') {
        const u = triangleWave((time + (m.phase || 0)) * (m.speed / Math.max(0.001, m.max - m.min)));
        this.root.position.x = m.min + (m.max - m.min) * u;
      } else if (m.type === 'sine') {
        this.root.position.x = m.cx + m.amp * Math.sin(((time + (m.phase || 0)) / m.period) * Math.PI * 2);
      }
    }
    if (dt > 0) {
      // mola amortecida (queda e retorno do alvo)
      const sub = Math.min(3, Math.ceil(dt / 0.008));
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        let acc;
        if (this.down) {
          acc = -24; // cai para tras como um alvo derrubado
        } else {
          acc = -this.stiffness * this.angle - (this.damping + (this.riseT > 0 ? 7 : 0)) * this.vel;
        }
        this.vel += acc * h;
        this.angle += this.vel * h;
        if (this.angle < this.minAngle) {
          this.angle = this.minAngle;
          this.vel = this.down && Math.abs(this.vel) > 1.5 ? -this.vel * 0.22 : Math.max(0, this.vel);
        }
        if (this.angle > this.maxAngle) { this.angle = this.maxAngle; this.vel = Math.min(0, this.vel); }
      }
      if (this.down) {
        this.downT -= dt;
        if (this.downT <= 0) { this.down = false; this.vel = 1.2; this.riseT = 1.2; }
      }
      if (this.riseT > 0) this.riseT -= dt;
      this.pivot.rotation.x = this.angle;
      if (this.flash > 0) {
        this.flash = Math.max(0, this.flash - dt * 4);
        const f = this.flash * 0.35;
        this.paper.emissive.setRGB(f, f * 0.8, f * 0.45);
      }
    }
  }
}
Target._next = 1;

export function makeTargetMaterials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.45, metalness: 0.85 }),
  };
}
