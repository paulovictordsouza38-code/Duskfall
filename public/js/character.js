// Operador tatico PROVISORIO, modelado por codigo (sem blocos): esqueleto de articulacoes,
// uniforme de tecido, colete com MOLLE, capacete, oculos, mascara, protecoes, luvas, coldre e botas.
// Animacao procedural por articulacoes (ciclo de passos sincronizado com a distancia percorrida)
// e bracos com IK de dois ossos para as maos acompanharem a arma (nada de mover o corpo todo).
//
// Para usar um modelo definitivo (.glb), veja README.md: a classe expoe `root` e o ponto de
// fixacao das armas, e o jogo ja tem a estrutura para carregar um arquivo em assets/.
import * as THREE from 'three';
import { roundedBox, cylinderAlong } from './geometry.js';

const UP_LEN = 0.31;
const FORE_LEN = 0.29;
const HIPS_Y = 0.95;
const FOOT_CLEAR = 0.05; // altura da origem do pe acima do solo (sola encosta no chao)

const DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const _aimQ = new THREE.Quaternion();
const _wq = new THREE.Quaternion();

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

function aimBone(bone, dirWorld) {
  bone.parent.getWorldQuaternion(_q1);
  _q2.setFromUnitVectors(DOWN, dirWorld);
  bone.quaternion.copy(_q1.invert()).multiply(_q2);
}

export class Character {
  constructor(lib) {
    this.lib = lib;
    this.root = new THREE.Group();
    this.root.name = 'operador';
    this.bones = {};
    this.time = 0;
    this.phase = 0;
    this.stepEvent = 0; // incrementa a cada passo (usado pelo audio)
    this._lastStepIdx = 0;
    this.hiddenForFPS = false;
    this._mats = {};
    this._buildMaterials(lib);
    this._buildRig();
    this._buildBody();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  // ------------------------------------------------------------------ materiais
  _fabric(rx, ry, color = 0xffffff) {
    const key = `f${rx}|${ry}|${color}`;
    if (this._mats[key]) return this._mats[key];
    const set = this.lib.fabric();
    const clone = (t, srgb) => {
      const c = t.clone();
      c.repeat.set(rx, ry);
      if (srgb) c.colorSpace = THREE.SRGBColorSpace;
      c.needsUpdate = true;
      return c;
    };
    const m = new THREE.MeshStandardMaterial({
      color,
      map: clone(set.map, true),
      roughnessMap: clone(set.roughnessMap),
      normalMap: clone(set.normalMap),
      roughness: 1,
      metalness: 0,
    });
    m.normalScale.set(0.9, 0.9);
    this._mats[key] = m;
    return m;
  }

  _buildMaterials(lib) {
    const molle = lib.molle();
    const molleClone = (t, srgb) => {
      const c = t.clone();
      c.repeat.set(2, 2);
      if (srgb) c.colorSpace = THREE.SRGBColorSpace;
      c.needsUpdate = true;
      return c;
    };
    const rubber = lib.rubber();
    this.m = {
      cloth: this._fabric(3, 2, 0xffffff),
      clothLimb: this._fabric(2, 3, 0xe8e8ec),
      vest: new THREE.MeshStandardMaterial({
        color: 0xc8cacd,
        map: molleClone(molle.map, true),
        roughnessMap: molleClone(molle.roughnessMap),
        normalMap: molleClone(molle.normalMap),
        roughness: 1,
        metalness: 0,
      }),
      plastic: new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.52, metalness: 0.15 }),
      plasticMatte: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.7, metalness: 0.05 }),
      rubber: new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: rubber.map,
        roughnessMap: rubber.roughnessMap,
        normalMap: rubber.normalMap,
        roughness: 1,
        metalness: 0,
      }),
      glove: new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.78, metalness: 0.02 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x3a3e43, roughness: 0.38, metalness: 0.9 }),
      helmet: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.46, metalness: 0.18 }),
      lens: new THREE.MeshPhysicalMaterial({ color: 0x050607, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
      boot: new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.6, metalness: 0.05 }),
      skin: this._fabric(2, 2, 0x9a9a9e),   // balaclava / touca preta cobre toda a pele
      hair: this._fabric(2, 2, 0x8a8a8e),
      liner: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95, metalness: 0, side: THREE.BackSide }),
      holster: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.55, metalness: 0.1 }),
    };
  }

  // ------------------------------------------------------------------ esqueleto
  _buildRig() {
    const B = this.bones;
    const mk = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(x, y, z);
      parent.add(g);
      B[name] = g;
      return g;
    };
    mk('hips', this.root, 0, HIPS_Y, 0);
    for (const [s, side] of [[-1, 'L'], [1, 'R']]) {
      const thigh = mk('thigh' + side, B.hips, s * 0.10, -0.04, 0);
      const shin = mk('shin' + side, thigh, 0, -0.44, 0);
      mk('foot' + side, shin, 0, -0.43, 0);
    }
    mk('spine', B.hips, 0, 0.05, 0);
    mk('chest', B.spine, 0, 0.13, 0);
    // ordem YXZ: primeiro gira (torcao), depois inclina no eixo ja girado
    B.hips.rotation.order = 'YXZ';
    B.spine.rotation.order = 'YXZ';
    B.chest.rotation.order = 'YXZ';
    mk('neck', B.chest, 0, 0.40, 0);
    mk('head', B.neck, 0, 0.08, 0);
    for (const [s, side] of [[-1, 'L'], [1, 'R']]) {
      const up = mk('upperArm' + side, B.chest, s * 0.21, 0.34, 0);
      const fore = mk('forearm' + side, up, 0, -UP_LEN, 0);
      mk('hand' + side, fore, 0, -FORE_LEN, 0);
    }
  }

  _mesh(geo, mat, parent, x = 0, y = 0, z = 0, rot = null, scale = null) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    parent.add(m);
    return m;
  }

  _buildBody() {
    const B = this.bones;
    const M = this.m;
    const mesh = this._mesh.bind(this);
    const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
    const rb = roundedBox;


    // ---- CORPO HUMANO FORTE por baixo da armadura (bombeiro/soldado): volume continuo, sem vazios
    mesh(new THREE.SphereGeometry(0.15, 20, 16), M.cloth, B.hips, 0, 0.0, 0, null, [1.1, 0.9, 0.8]);          // pelve/gluteos
    mesh(new THREE.SphereGeometry(0.16, 22, 16), M.cloth, B.spine, 0, 0.06, 0, null, [1.05, 1.0, 0.78]);      // abdomen
    mesh(new THREE.SphereGeometry(0.19, 24, 18), M.cloth, B.chest, 0, 0.2, 0.0, null, [1.08, 1.25, 0.8]);     // peitoral largo
    mesh(new THREE.SphereGeometry(0.1, 14, 12), M.cloth, B.chest, 0, 0.42, 0.01, null, [1.9, 0.6, 0.9]);      // trapezio
    for (const [s, side] of [[-1, 'L'], [1, 'R']]) {
      const up = B['upperArm' + side];
      const fore = B['forearm' + side];
      const hand = B['hand' + side];
      const thigh = B['thigh' + side];
      const shin = B['shin' + side];
      const foot = B['foot' + side];
      mesh(new THREE.SphereGeometry(0.098, 16, 14), M.cloth, up, 0, 0.0, 0);                                  // deltoide
      mesh(new THREE.CapsuleGeometry(0.078, 0.2, 6, 14), M.cloth, up, 0, -0.15, 0);                           // biceps/triceps
      mesh(new THREE.SphereGeometry(0.066, 12, 10), M.cloth, fore, 0, 0.0, 0);                                // cotovelo
      mesh(new THREE.CapsuleGeometry(0.068, 0.17, 6, 12), M.cloth, fore, 0, -0.14, 0);                        // antebraco forte
      mesh(new THREE.CapsuleGeometry(0.036, 0.04, 4, 10), M.skin, hand, 0, -0.03, 0);                         // pulso (pele sob a luva)
      mesh(new THREE.SphereGeometry(0.12, 16, 14), M.cloth, thigh, 0, 0.0, 0);                                 // quadril
      mesh(new THREE.CapsuleGeometry(0.118, 0.3, 6, 16), M.cloth, thigh, 0, -0.22, 0);                        // coxa musculosa
      mesh(new THREE.SphereGeometry(0.09, 14, 12), M.cloth, shin, 0, 0.0, 0);                                // joelho
      mesh(new THREE.CapsuleGeometry(0.088, 0.3, 6, 14), M.cloth, shin, 0, -0.2, 0);                           // panturrilha
      mesh(new THREE.SphereGeometry(0.078, 12, 10), M.boot, shin, 0, -0.43, 0);                                // tornozelo
    }
    // pescoco forte (pele) e cabeca com rosto de verdade, orelhas e cabelo curto
    mesh(new THREE.CylinderGeometry(0.088, 0.105, 0.16, 18), M.skin, B.neck, 0, 0.02, 0);
    mesh(new THREE.SphereGeometry(0.098, 22, 18), M.skin, B.head, 0, 0.1, 0.0, null, [0.98, 1.15, 1.08]);     // cranio/rosto
    mesh(new THREE.SphereGeometry(0.1, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hair, B.head, 0, 0.11, 0.008, null, [0.99, 1.1, 1.1]);   // cabelo curto
    mesh(new THREE.SphereGeometry(0.052, 12, 10), M.skin, B.head, 0, 0.0, -0.045, null, [1.45, 0.85, 0.95]); // maxilar
    mesh(new THREE.SphereGeometry(0.02, 8, 8), M.skin, B.head, 0, 0.065, -0.1, null, [1, 1.3, 1.2]);          // nariz
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.02, 8, 8), M.skin, B.head, s * 0.1, 0.075, 0.0, null, [0.5, 1.4, 1]);   // orelha
      mesh(new THREE.SphereGeometry(0.014, 8, 8), M.glove, B.head, s * 0.036, 0.1, -0.095);                    // olho
    }
    mesh(new THREE.SphereGeometry(0.146, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), M.liner, B.head, 0, 0.105, 0.006, null, [1, 0.92, 1.14]); // interior do capacete fechado

    // ---- pelve, cintura e cinto (cinto largo com fivela, bolsas)
    mesh(rb(0.31, 0.17, 0.2, 0.06), M.cloth, B.hips, 0, 0.0, 0);
    mesh(rb(0.3, 0.2, 0.19, 0.06), M.cloth, B.spine, 0, 0.04, 0);
    const belt = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.062, 28), M.plasticMatte, B.hips, 0, 0.068, 0, null, [1, 1, 0.68]);
    belt.name = 'cinto';
    mesh(rb(0.06, 0.045, 0.014, 0.006), M.metal, B.hips, 0, 0.068, -0.14);            // fivela
    mesh(rb(0.03, 0.05, 0.02, 0.006), M.plastic, B.hips, 0.05, 0.068, -0.14);          // ponta do cinto
    mesh(rb(0.07, 0.07, 0.045, 0.012), M.plasticMatte, B.hips, -0.17, 0.05, -0.02);    // bolsa lateral
    mesh(rb(0.09, 0.08, 0.05, 0.014), M.plasticMatte, B.hips, 0.0, 0.07, 0.12);        // bolsa traseira

    // ---- pernas (calca cargo larga, bolsos, joelheiras, bota alta)
    for (const [s, side] of [[-1, 'L'], [1, 'R']]) {
      const thigh = B['thigh' + side];
      const shin = B['shin' + side];
      const foot = B['foot' + side];
      mesh(cap(0.122, 0.30), M.clothLimb, thigh, 0, -0.22, 0);
      // bolso cargo lateral grande com aba e botao
      mesh(rb(0.055, 0.2, 0.17, 0.022), M.cloth, thigh, s * 0.128, -0.2, 0.0);
      mesh(rb(0.06, 0.05, 0.18, 0.014), M.cloth, thigh, s * 0.13, -0.115, 0.0);
      mesh(cylinderAlong('x', 0.01, 0.012, 8), M.plasticMatte, thigh, s * 0.162, -0.115, 0.0);
      mesh(rb(0.06, 0.1, 0.012, 0.005), M.cloth, thigh, s * 0.13, -0.3, -0.088);     // divisoria do bolso
      // bolso traseiro com aba
      mesh(rb(0.13, 0.1, 0.02, 0.01), M.cloth, thigh, 0, -0.1, 0.118);
      mesh(rb(0.13, 0.03, 0.026, 0.008), M.cloth, thigh, 0, -0.065, 0.122);
      // canela
      mesh(cap(0.09, 0.30), M.clothLimb, shin, 0, -0.215, 0);
      // joelheira grande: casca + almofada + tiras
      mesh(rb(0.15, 0.18, 0.09, 0.042), M.plastic, shin, 0, -0.02, -0.092);
      mesh(rb(0.105, 0.115, 0.022, 0.014), M.rubber, shin, 0, -0.02, -0.14);
      mesh(cylinderAlong('y', 0.098, 0.018, 16), M.plasticMatte, shin, 0, 0.09, 0);
      mesh(cylinderAlong('y', 0.094, 0.018, 16), M.plasticMatte, shin, 0, -0.12, 0);
      // barra da calca "blusada" dentro da bota
      mesh(new THREE.TorusGeometry(0.08, 0.026, 8, 18), M.clothLimb, shin, 0, -0.245, 0, [Math.PI / 2, 0, 0]);
      // cano da bota alto + acolchoado do tornozelo
      mesh(new THREE.CylinderGeometry(0.072, 0.08, 0.25, 18), M.boot, shin, 0, -0.34, 0);
      mesh(new THREE.TorusGeometry(0.073, 0.012, 6, 18), M.plasticMatte, shin, 0, -0.215, 0, [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 6; i++) {                                                                     // cadarcos cruzados
        mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.075, 6), M.plasticMatte, shin, 0, -0.245 - i * 0.032, -0.074, [0, 0, Math.PI / 2]);
        mesh(new THREE.SphereGeometry(0.008, 6, 6), M.metal, shin, -0.038, -0.245 - i * 0.032, -0.07);
        mesh(new THREE.SphereGeometry(0.008, 6, 6), M.metal, shin, 0.038, -0.245 - i * 0.032, -0.07);
      }
      // pe da bota: sola grossa com garras, biqueira reforcada
      mesh(rb(0.108, 0.1, 0.275, 0.04), M.boot, foot, 0, 0.004, -0.05);
      mesh(rb(0.12, 0.045, 0.31, 0.018), M.rubber, foot, 0, -0.03, -0.05);
      for (let i = 0; i < 5; i++) mesh(rb(0.124, 0.012, 0.012, 0.004), M.plasticMatte, foot, 0, -0.056, -0.15 + i * 0.05);
      mesh(rb(0.098, 0.075, 0.09, 0.032), M.boot, foot, 0, 0.014, -0.15);
    }
    // perneira de coldre (coxa direita): plataforma + coldre + pistola + 2 tiras
    {
      const th = B.thighR;
      mesh(rb(0.03, 0.22, 0.095, 0.014), M.holster, th, 0.15, -0.19, 0.0);                  // plataforma
      mesh(rb(0.04, 0.17, 0.07, 0.016), M.holster, th, 0.17, -0.2, -0.005);                  // coldre
      mesh(rb(0.026, 0.07, 0.05, 0.01), M.metal, th, 0.172, -0.08, 0.025);                   // empunhadura da pistola
      mesh(rb(0.03, 0.02, 0.04, 0.008), M.plasticMatte, th, 0.17, -0.1, -0.02);              // trava
      mesh(cylinderAlong('y', 0.126, 0.03, 18), M.plasticMatte, th, 0.0, -0.13, 0.0);        // tiras de perna
      mesh(cylinderAlong('y', 0.122, 0.028, 18), M.plasticMatte, th, 0.0, -0.3, 0.0);
      mesh(rb(0.022, 0.034, 0.02, 0.006), M.metal, th, 0.14, -0.13, -0.095);               // fivelas
      mesh(rb(0.022, 0.034, 0.02, 0.006), M.metal, th, 0.136, -0.3, -0.092);
    }

    // ---- tronco: camisa de gola alta, colete porta-placas, bolsos
    mesh(rb(0.345, 0.47, 0.22, 0.075), M.cloth, B.chest, 0, 0.17, 0);
    const vest = mesh(rb(0.39, 0.45, 0.26, 0.06), M.vest, B.chest, 0, 0.165, 0.0);
    vest.name = 'colete';
    mesh(rb(0.41, 0.1, 0.275, 0.04), M.vest, B.spine, 0, 0.035, 0);                          // faixa lateral (cummerbund)
    for (const s of [-1, 1]) {                                                                // bolsas laterais do colete
      mesh(rb(0.05, 0.12, 0.1, 0.016), M.vest, B.chest, s * 0.212, 0.06, -0.02);
      mesh(rb(0.052, 0.03, 0.105, 0.01), M.plasticMatte, B.chest, s * 0.212, 0.125, -0.02);
    }
    for (const x of [-0.108, 0, 0.108]) {                                                     // 3 porta-carregadores frontais
      mesh(rb(0.095, 0.13, 0.05, 0.016), M.vest, B.chest, x, 0.07, -0.152);
      mesh(rb(0.095, 0.04, 0.056, 0.012), M.plasticMatte, B.chest, x, 0.125, -0.155);      // aba
      mesh(rb(0.018, 0.022, 0.01, 0.004), M.metal, B.chest, x, 0.112, -0.185);             // fecho
    }
    mesh(rb(0.22, 0.1, 0.04, 0.014), M.vest, B.chest, 0, 0.26, -0.15);                       // painel superior MOLLE
    mesh(rb(0.075, 0.075, 0.03, 0.01), M.plasticMatte, B.chest, 0.1, 0.34, -0.135);          // radio/identificacao
    mesh(rb(0.35, 0.42, 0.05, 0.02), M.vest, B.chest, 0, 0.17, 0.148);                       // painel traseiro MOLLE
    mesh(rb(0.14, 0.09, 0.04, 0.012), M.plasticMatte, B.chest, 0, 0.32, 0.178);              // alca de resgate
    for (let i = 0; i < 4; i++) mesh(rb(0.3, 0.008, 0.01, 0.003), M.plasticMatte, B.chest, 0, 0.0 + i * 0.09, 0.178);
    for (const s of [-1, 1]) {                                                                // alcas de ombro com fivela
      mesh(rb(0.08, 0.055, 0.25, 0.02), M.vest, B.chest, s * 0.125, 0.4, 0.0);
      mesh(rb(0.034, 0.024, 0.034, 0.006), M.metal, B.chest, s * 0.125, 0.432, -0.095);
      mesh(rb(0.045, 0.05, 0.02, 0.008), M.plasticMatte, B.chest, s * 0.19, 0.355, 0.0);   // fixador do lado
    }

    // ---- gola alta e pescoco (gola rolê preta)
    mesh(new THREE.CylinderGeometry(0.082, 0.1, 0.12, 20), M.cloth, B.neck, 0, 0.0, 0);
    mesh(new THREE.TorusGeometry(0.09, 0.028, 8, 20), M.cloth, B.neck, 0, -0.02, 0, [Math.PI / 2, 0, 0]);
    mesh(rb(0.16, 0.05, 0.06, 0.02), M.cloth, B.neck, 0, -0.03, -0.07);                      // abertura frontal da gola

    // ---- cabeca (escondida na 1a pessoa)
    const head = B.head;
    const face = mesh(new THREE.SphereGeometry(0.1, 20, 16), M.skin, head, 0, 0.075, 0, null, [0.97, 1.12, 1.1]);
    face.name = 'rosto';
    // mascara facial rigida (nariz ao queixo) com pecas laterais e fendas
    mesh(rb(0.13, 0.085, 0.07, 0.03), M.plasticMatte, head, 0, 0.032, -0.092);               // corpo da mascara
    mesh(rb(0.06, 0.05, 0.06, 0.02), M.plasticMatte, head, 0, 0.065, -0.112, [-0.35, 0, 0]);  // nariz
    mesh(rb(0.1, 0.034, 0.05, 0.016), M.plasticMatte, head, 0, -0.012, -0.085);              // queixo
    for (let i = 0; i < 4; i++) mesh(rb(0.07, 0.004, 0.006, 0.002), M.glove, head, 0, 0.0 + i * 0.016, -0.129);
    for (const s of [-1, 1]) {
      mesh(rb(0.03, 0.08, 0.07, 0.014), M.plasticMatte, head, s * 0.082, 0.035, -0.05);      // bochechas
      mesh(cylinderAlong('z', 0.006, 0.12, 6), M.plasticMatte, head, s * 0.1, 0.0, -0.01);   // tira do queixo
    }
    mesh(rb(0.1, 0.03, 0.04, 0.012), M.plasticMatte, head, 0, -0.06, -0.05);               // mascara cai sobre a gola
    // oculos de protecao: moldura grossa, lente larga escura, elastico em volta do capacete
    mesh(rb(0.2, 0.08, 0.055, 0.03), M.plastic, head, 0, 0.1, -0.098);
    mesh(rb(0.176, 0.056, 0.016, 0.022), M.lens, head, 0, 0.1, -0.128);
    mesh(rb(0.04, 0.03, 0.04, 0.012), M.plastic, head, 0, 0.068, -0.108);                   // ponte do nariz
    const strap = mesh(new THREE.TorusGeometry(0.11, 0.016, 6, 28), M.plasticMatte, head, 0, 0.1, 0, [Math.PI / 2, 0, 0], [1, 1.1, 1]);
    strap.name = 'elastico';
    // capacete tipo FAST: casca, aba frontal, laterais recortadas, trilhos, protetores de ouvido
    const helmet = mesh(new THREE.SphereGeometry(0.15, 30, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), M.helmet, head, 0, 0.105, 0.006, null, [1, 0.92, 1.14]);
    helmet.name = 'capacete';
    mesh(new THREE.TorusGeometry(0.153, 0.012, 6, 30), M.helmet, head, 0, 0.103, 0.006, [Math.PI / 2, 0, 0], [1, 1.14, 1]);   // aba
    mesh(rb(0.16, 0.014, 0.05, 0.006), M.helmet, head, 0, 0.19, -0.155, [-0.4, 0, 0]);                                    // viseira frontal
    for (const s of [-1, 1]) {
      mesh(rb(0.016, 0.04, 0.15, 0.006), M.metal, head, s * 0.146, 0.125, 0.0);          // trilho lateral
      mesh(rb(0.02, 0.026, 0.04, 0.008), M.plasticMatte, head, s * 0.15, 0.12, -0.05);   // lanterna/ARC
      mesh(cylinderAlong('x', 0.052, 0.036, 20), M.plastic, head, s * 0.136, 0.055, 0.015); // concha do protetor de ouvido
      mesh(cylinderAlong('x', 0.036, 0.02, 16), M.plasticMatte, head, s * 0.155, 0.055, 0.015);
    }
    // suporte de NVG grande e quadrado no centro da testa, com janela escura
    mesh(rb(0.11, 0.09, 0.05, 0.016), M.plastic, head, 0, 0.19, -0.145, [-0.28, 0, 0]);
    mesh(rb(0.07, 0.056, 0.016, 0.01), M.lens, head, 0, 0.19, -0.172, [-0.28, 0, 0]);
    mesh(rb(0.03, 0.02, 0.03, 0.008), M.metal, head, 0, 0.245, -0.12, [-0.28, 0, 0]);
    mesh(rb(0.06, 0.035, 0.055, 0.012), M.plastic, head, 0, 0.2, 0.15, [0.3, 0, 0]);       // contrapeso traseiro
    mesh(rb(0.05, 0.04, 0.032, 0.012), M.plasticMatte, head, 0, 0.222, 0.0);               // luz no topo
    mesh(new THREE.TorusGeometry(0.1, 0.007, 5, 20, Math.PI), M.plasticMatte, head, 0, 0.02, -0.01, [0, 0, Math.PI]); // jugular

    // ---- bracos
    for (const [s, side] of [[-1, 'L'], [1, 'R']]) {
      const up = B['upperArm' + side];
      const fore = B['forearm' + side];
      const hand = B['hand' + side];
      mesh(cap(0.08, 0.205), M.clothLimb, up, 0, -0.155, 0);
      // ombreira blindada: calota grande + 2 laminas sobrepostas + alca
      const pad = mesh(new THREE.SphereGeometry(0.122, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), M.plastic, up, s * 0.014, 0.014, 0.0, [0, 0, s * -0.3], [1.25, 0.95, 1.15]);
      pad.name = 'ombreira';
      mesh(rb(0.135, 0.03, 0.17, 0.014), M.plasticMatte, up, s * 0.048, -0.025, 0.0, [0, 0, s * -0.32]);
      mesh(rb(0.12, 0.028, 0.15, 0.013), M.plastic, up, s * 0.054, -0.062, 0.0, [0, 0, s * -0.34]);
      mesh(rb(0.03, 0.05, 0.12, 0.01), M.plasticMatte, up, s * -0.02, 0.05, 0.0);
      // manga + cotoveleira
      mesh(cap(0.07, 0.19), M.clothLimb, fore, 0, -0.145, 0);
      mesh(rb(0.115, 0.12, 0.09, 0.038), M.plastic, fore, 0, 0.0, 0.07);
      mesh(rb(0.085, 0.085, 0.012, 0.01), M.rubber, fore, 0, 0.0, 0.118);
      // luvas taticas pretas: mao inteira coberta (palma, dedos separados, polegar, nos dos dedos e punho)
      mesh(rb(0.098, 0.1, 0.056, 0.022), M.glove, hand, 0, -0.055, 0);
      mesh(rb(0.1, 0.045, 0.062, 0.016), M.glove, hand, 0, -0.012, 0);                          // punho da luva
      mesh(rb(0.102, 0.018, 0.068, 0.006), M.plasticMatte, hand, 0, -0.03, 0);                 // tira de velcro
      for (let i = 0; i < 4; i++) {
        const fx = (i - 1.5) * 0.024;
        mesh(cap(0.0125, 0.046), M.glove, hand, fx, -0.138, 0.0, [0.12, 0, 0]);               // dedos
        mesh(cap(0.011, 0.02), M.glove, hand, fx, -0.178, -0.004, [0.5, 0, 0]);               // pontas
      }
      mesh(rb(0.086, 0.04, 0.016, 0.008), M.plastic, hand, 0, -0.1, 0.032);                    // placa dos nos dos dedos
      mesh(cap(0.017, 0.055), M.glove, hand, s * -0.058, -0.075, -0.006, [0, 0, s * 0.55]);   // polegar
    }
  }

  // ------------------------------------------------------------------ utilidades
  /** Esconde cabeca/capacete quando a camera esta nos olhos (1a pessoa). */
  setHeadVisible(v) {
    if (this.bones.head.visible !== v) this.bones.head.visible = v;
    if (this.skin) this.skin.setHeadVisible(v);
  }

  /** Troca o corpo procedural pelo modelo com esqueleto (o procedural segue rodando por baixo, so invisivel). */
  attachSkin(skin) {
    this.root.traverse((o) => { if (o.isMesh) o.visible = false; });
    this.root.add(skin.group);
    this.skin = skin;
  }

  /** Posicao dos olhos no mundo (estavel, sem tremor) para camera e alinhamento da arma. */
  eyePosition(out, aimYaw) {
    const r = this.root.position;
    const bob = (this.bones.hips.position.y - HIPS_Y) * 0.5;
    const pk = this.proneK || 0;                                    // deitado: olho baixo e adiantado
    out.set(r.x - Math.sin(aimYaw) * (0.09 - 0.7 * pk), r.y + 1.69 - 0.46 * (this.crouchK || 0) - 1.28 * pk + bob, r.z - Math.cos(aimYaw) * (0.09 - 0.7 * pk));
    return out;
  }

  headPosition(out) {
    return this.bones.head.getWorldPosition(out);
  }

  // ------------------------------------------------------------------ animacao
  /**
   * @param {number} dt
   * @param {object} p
   *  p.speed, p.lx/p.lz (velocidade local: direita/frente), p.hipsYaw, p.aimYaw, p.aimPitch, p.aimBlend,
   *  p.rig (arma), p.draw (0..1), p.reload (-1 ou 0..1), p.recoil (0..1), p.slide (0..1)
   */
  update(dt, p) {
    const B = this.bones;
    this.time += dt;
    this._dt = dt > 0 ? dt : 0.016;
    const root = this.root;
    root.rotation.y = p.hipsYaw;

    // ---- postura militar: corpo sempre voltado para a mira, joelhos flexionados, passos curtos e firmes
    const sp = p.speed;
    const moveAmt = smooth(sp / 0.6);
    const runK = clamp((sp - 2.6) / 2.2, 0, 1);               // 0 = marcha tatica, 1 = corrida
    const sprintLean = runK * (1 - smooth(p.aimBlend));
    const air = smooth(p.air || 0);                            // 1 = no ar (pulo)
    const mvk = moveAmt * (1 - air);
    const cr = smooth(p.crouch || 0);                          // 0 = em pe, 1 = agachado
    this.crouchK = cr;
    let fz = 0;
    let fx = 0;
    if (sp > 0.05) { const l = Math.hypot(p.lx, p.lz) || 1; fx = p.lx / l; fz = p.lz / l; }  // direcao no referencial do corpo
    const A = (0.40 + 0.30 * runK) * (1 - 0.35 * cr);                              // balanco frontal (feet nao deslizam: ~ comprimento do passo)
    const ALAT = 0.30;                                         // abertura lateral ao andar de lado
    const stride = (0.62 + 0.46 * runK) * (1 - 0.25 * cr);                       // passos curtos e firmes na marcha tatica; largos na corrida                         // metros por passo
    if (sp > 0.02) this.phase += (sp * dt / stride) * Math.PI;
    const K = 0.85 + 0.6 * runK;                               // flexao do joelho na fase de balanco
    const stepIdx = Math.floor(this.phase / Math.PI);
    if (stepIdx !== this._lastStepIdx) {
      this._lastStepIdx = stepIdx;
      if (sp > 0.3) this.stepEvent += 1;
    }
    const BASE_T = 0.20 + 0.10 * runK + 0.78 * cr;                                       // coxa levemente a frente (agachamento tatico)
    const BASE_K = 0.50 + 0.22 * runK + 1.40 * cr;                                       // joelho flexionado
    const stance = 1 - moveAmt;                                // parado: pe direito um pouco a frente (postura de tiro)

    for (const [s, side] of [[-1, 'L'], [1, 'R']]) {
      const psi = this.phase + (side === 'L' ? 0 : Math.PI);
      const thigh = B['thigh' + side];
      const shin = B['shin' + side];
      const foot = B['foot' + side];
      const sw = Math.sin(psi);
      thigh.rotation.x = BASE_T + A * fz * sw * mvk + (side === 'R' ? 0.10 : -0.05) * stance * (1 - air) + (side === 'R' ? 0.95 : 0.6) * air;
      thigh.rotation.z = s * 0.07 + ALAT * fx * sw * mvk;
      const c = Math.max(0, Math.cos(psi + 0.2));
      shin.rotation.x = -(BASE_K + K * c * c * mvk + 1.1 * air);
      // rolamento do pe: calcanhar toca primeiro, depois a sola, e o calcanhar levanta na impulsao
      foot.rotation.x = -(thigh.rotation.x + shin.rotation.x) * 0.9 + (0.30 * Math.max(0, sw) - 0.55 * Math.max(0, -sw) * (1 - 0.4 * runK)) * mvk;
    }
    // pelve quase parada: so um leve giro com os passos
    B.hips.rotation.y = Math.sin(this.phase) * (0.06 + 0.05 * runK) * moveAmt;
    B.hips.rotation.z = Math.sin(this.phase) * (0.03 + 0.03 * runK) * mvk;       // pelve inclina com o passo
    B.hips.position.x = Math.sin(this.phase) * (0.02 + 0.012 * runK) * mvk;      // peso passa de uma perna para a outra

    // ---- tronco: leve inclinacao a frente, mira, torcao, respiracao, recuo
    const breathe = Math.sin(this.time * 1.7) * 0.006;
    const recoilKick = (p.recoil || 0) * 0.045;
    const lean = -(0.10 + 0.14 * sprintLean + 0.16 * cr);
    this.sprintLean = sprintLean;
    B.spine.rotation.x = lean * 0.6 + p.aimPitch * 0.18;
    B.chest.rotation.x = lean * 0.4 + p.aimPitch * 0.24 + recoilKick + breathe;
    const twist = clamp(wrapAngle(p.aimYaw - p.hipsYaw), -1.75, 1.75) - B.hips.rotation.y;
    B.spine.rotation.y = twist * 0.45 - B.hips.rotation.y * 0.8;                 // tronco firme: contra-gira a pelve
    B.chest.rotation.y = twist * 0.55;
    B.spine.rotation.z = -Math.sin(this.phase) * 0.012 * moveAmt;
    B.neck.rotation.x = p.aimPitch * 0.25 - lean * 0.7;        // cabeca estavel e nivelada
    B.head.rotation.x = p.aimPitch * 0.35;
    B.head.rotation.y = -B.chest.rotation.y * 0.1;

    // ---- contato com o solo: abaixa a pelve ate o pe mais baixo tocar o chao
    B.hips.position.y = HIPS_Y;
    root.updateMatrixWorld(true);
    B.footL.getWorldPosition(_v1);
    B.footR.getWorldPosition(_v2);
    const low = Math.min(_v1.y, _v2.y) - root.position.y;
    B.hips.position.y += (FOOT_CLEAR - low) * (1 - air);
    B.hips.position.y += runK * mvk * 0.05 * (0.5 + 0.5 * Math.cos(2 * this.phase + 0.5));   // fase de voo da corrida
    root.updateMatrixWorld(true);

    // ---- arma e bracos
    if (p.rig) {
      this._placeWeapon(p);
      this._solveArms(p);
    } else {
      this._freeArms(runK, mvk, cr);
    }
    if (this.skin) {
      try { this.skin.update(dt, p, this); } catch (err) {
        console.warn('Falha no operador com esqueleto; voltando ao procedural:', err);
        this.skin.group.visible = false;
        this.skin = null;
        this.root.traverse((o) => { if (o.isMesh) o.visible = true; });
      }
    }
  }

  /** Maos livres (desarmado): bracos balancam contra as pernas, cotovelos dobrados como um soldado correndo. */
  _freeArms(runK, mvk, cr) {
    const B = this.bones;
    for (const [s, side] of [[-1, 'L'], [1, 'R']]) {
      const psi = this.phase + (side === 'L' ? Math.PI : 0);
      const up = B['upperArm' + side];
      const fore = B['forearm' + side];
      const hand = B['hand' + side];
      const swing = Math.sin(psi) * (0.38 + 0.75 * runK) * mvk;
      up.rotation.set(0.12 + swing - 0.2 * cr, 0, s * (0.1 + 0.05 * runK));
      fore.rotation.set(0.35 + 1.0 * runK * mvk + Math.max(0, swing) * 0.5, 0, 0);
      hand.rotation.set(0, 0, 0);
    }
  }

  _placeWeapon(p) {
    const rig = p.rig;
    const g = rig.group;
    const B = this.bones;
    _eul.set(p.aimPitch, p.aimYaw, 0, 'YXZ');
    _aimQ.setFromEuler(_eul);

    // olho (para ADS) e peito (para posicao de transporte)
    this.eyePosition(_v1, p.aimYaw);
    _v2.set(0, 0, -1).applyQuaternion(_aimQ);                 // frente da mira
    const pull = p.wallPull || 0;
    const sl = this.sprintLean || 0;
    _v3.copy(_v1).addScaledVector(_v2, rig.eyeDist - pull);   // posicao em ADS (origem = mira traseira sobre o eixo da visao)
    B.chest.getWorldPosition(_v4);
    _v1.set(rig.carry.pos[0], rig.carry.pos[1] - 0.26 * sl, rig.carry.pos[2] + 0.06 * sl).applyQuaternion(_aimQ).add(_v4); // transporte (pronto; baixa ao correr)
    _v1.addScaledVector(_v2, -pull);
    const t = smooth(p.aimBlend);
    g.position.lerpVectors(_v1, _v3, t);

    // respiracao suave (menos ao mirar) e balanco dos passos com a arma firme
    g.position.y += Math.sin(this.time * 1.7) * 0.0016 * (1 - t * 0.75);
    const wk = smooth(p.speed / 0.6) * (1 - smooth(p.air || 0));
    g.position.y += Math.sin(this.phase * 2 + 0.4) * (0.008 + 0.004 * (this.sprintLean || 0)) * wk * (1 - t * 0.85);

    // saque, recarga, recuo (sobre a orientacao da mira)
    const draw = p.draw === undefined ? 1 : p.draw;
    const drawPitch = (1 - smooth(draw)) * -0.9;
    g.position.y += (1 - smooth(draw)) * -0.22;
    let roll = 0;
    let pitchExtra = drawPitch + (p.recoil || 0) * 0.07 - 0.5 * sl * (1 - t);
    if (p.reload >= 0) {
      const r = p.reload;
      const tilt = Math.sin(clamp(r / 0.9, 0, 1) * Math.PI);
      roll = 0.28 * tilt;
      pitchExtra += 0.22 * tilt * (1 - t * 0.6);
    }
    g.position.addScaledVector(_v2, -(p.recoil || 0) * 0.03);
    // filtro passa-baixa (no referencial do corpo): ao correr a arma vai firme, sem os bracos "tremendo"
    // como se estivessem atirando; mirando/atirando o filtro e rapido e nada atrasa
    const rate = 46 - 40 * sl * (1 - t) * (1 - Math.min(1, (p.recoil || 0) * 2));
    this._wOff = this._wOff || new THREE.Vector3();
    _v1.copy(g.position).sub(this.root.position);
    if (!this._wInit) { this._wOff.copy(_v1); this._wInit = true; }
    this._wOff.lerp(_v1, 1 - Math.exp(-rate * (this._dt || 0.016)));
    g.position.copy(this.root.position).add(this._wOff);
    _q1.setFromEuler(_eul.set(pitchExtra, 0, roll, 'XYZ'));
    g.quaternion.copy(_aimQ).multiply(_q1);
    g.updateMatrixWorld(true);

    // pecas moveis da arma
    const slide = rig.parts.slide;
    const mag = rig.parts.mag;
    let slideZ = (p.slide || 0) * rig.slideTravel;
    mag.visible = true;
    mag.position.set(0, 0, 0);
    if (p.reload >= 0) {
      const r = p.reload;
      // 0.18-0.34: carregador velho sai para baixo; 0.34-0.58: sem carregador; 0.58-0.8: carregador novo sobe; 0.82-0.96: engatilha
      if (r > 0.18 && r < 0.34) mag.position.y = -smooth(seg(r, 0.18, 0.34)) * 0.16;
      else if (r >= 0.34 && r < 0.58) mag.visible = false;
      else if (r >= 0.58 && r < 0.84) mag.position.y = -(1 - smooth(seg(r, 0.58, 0.84))) * 0.18;
      if (r > 0.84 && r < 0.97) slideZ = Math.sin(seg(r, 0.84, 0.97) * Math.PI) * rig.slideTravel * 1.1;
    }
    slide.position.z = slideZ;
    g.updateMatrixWorld(true);
  }

  _handTargets(p) {
    const rig = p.rig;
    const g = rig.group;
    const gr = rig.grips;
    // mao direita: empunhadura
    _v1.set(gr.r.pos[0], gr.r.pos[1], gr.r.pos[2]);
    g.localToWorld(_v1);
    this._rTarget = this._rTarget || new THREE.Vector3();
    this._lTarget = this._lTarget || new THREE.Vector3();
    this._rTarget.copy(_v1);
    // mao esquerda: apoio ou sequencia de recarga
    const fore = _v2.set(gr.l.pos[0], gr.l.pos[1], gr.l.pos[2]);
    g.localToWorld(fore);
    const well = _v3.set(gr.magWell[0], gr.magWell[1] - 0.03, gr.magWell[2]);
    g.localToWorld(well);
    if (p.reload >= 0) {
      const r = p.reload;
      this.bones.chest.localToWorld(_v4.set(-0.12, 0.02, -0.19)); // bolsa de carregadores (esquerda do peito)
      if (r < 0.18) this._lTarget.lerpVectors(fore, well, smooth(seg(r, 0, 0.18)));
      else if (r < 0.38) this._lTarget.lerpVectors(well, _v4, smooth(seg(r, 0.18, 0.38)));
      else if (r < 0.58) this._lTarget.copy(_v4);
      else if (r < 0.8) this._lTarget.lerpVectors(_v4, well, smooth(seg(r, 0.58, 0.8)));
      else if (r < 0.9) this._lTarget.copy(well);
      else this._lTarget.lerpVectors(well, fore, smooth(seg(r, 0.9, 1)));
    } else {
      this._lTarget.copy(fore);
    }
  }

  _solveArms(p) {
    this._handTargets(p);
    const g = p.rig.group;
    const gr = p.rig.grips;
    g.getWorldQuaternion(_wq);

    // mao direita
    _q3.setFromEuler(_eul.set(gr.r.rot[0], gr.r.rot[1], gr.r.rot[2], 'XYZ'));
    _q3.premultiply(_wq);
    this._solveArm('R', this._rTarget, _q3, 1);
    // mao esquerda
    _q3.setFromEuler(_eul.set(gr.l.rot[0], gr.l.rot[1], gr.l.rot[2], 'XYZ'));
    _q3.premultiply(_wq);
    this._solveArm('L', this._lTarget, _q3, -1);
  }

  _solveArm(side, target, handQ, s) {
    const B = this.bones;
    const upper = B['upperArm' + side];
    const fore = B['forearm' + side];
    const hand = B['hand' + side];

    upper.getWorldPosition(_S);
    _v1.subVectors(target, _S);
    let dist = _v1.length();
    if (dist < 1e-5) return;
    _v1.multiplyScalar(1 / dist);                                   // u (direcao ombro -> alvo)
    dist = clamp(dist, Math.abs(UP_LEN - FORE_LEN) + 0.02, UP_LEN + FORE_LEN - 0.002);

    const cosA = clamp((UP_LEN * UP_LEN + dist * dist - FORE_LEN * FORE_LEN) / (2 * UP_LEN * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);

    // polo: cotovelo para baixo e para fora (no referencial do peito)
    B.chest.getWorldQuaternion(_q1);
    _v2.set(s * 0.55, -1, 0.35).applyQuaternion(_q1);
    _v2.addScaledVector(_v1, -_v2.dot(_v1));
    if (_v2.lengthSq() < 1e-6) _v2.set(0, -1, 0);
    _v2.normalize();

    _E.copy(_S).addScaledVector(_v1, UP_LEN * cosA).addScaledVector(_v2, UP_LEN * sinA);

    _v3.subVectors(_E, _S).multiplyScalar(1 / UP_LEN);
    aimBone(upper, _v3);
    upper.updateMatrixWorld(true);

    _v4.copy(_S).addScaledVector(_v1, dist).sub(_E).multiplyScalar(1 / FORE_LEN);
    aimBone(fore, _v4);
    fore.updateMatrixWorld(true);

    fore.getWorldQuaternion(_q1);
    hand.quaternion.copy(_q1.invert()).multiply(handQ);
    hand.updateMatrixWorld(true);
  }
}
