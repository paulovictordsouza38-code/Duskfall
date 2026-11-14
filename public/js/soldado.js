// Operador tatico REAL (Meshy + Mixamo): malha com esqueleto (41 ossos) e animacoes idle/walk/run.
// O Character procedural continua rodando por baixo (camera, arma, passos, ancoras); esta classe so
// desenha o corpo definitivo por cima dele e liga as maos as empunhaduras da arma por IK.
import * as THREE from 'three';
import { SOLDADO, SOLDADO_TEX } from './soldado_data.js';

const SCALE = 0.96;                // modelo mede ~1.87 m; o jogo usa ~1.8 m
const CLIP_SPEED = { walk: 1.29, run: 4.67 };   // m/s de cada clipe original (deslocamento da raiz / duracao)
const CLIP_DIST = { walk: 1.716, run: 3.267 };  // distancia por ciclo
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function b64(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
function half(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    out[i] = e === 0 ? s * Math.pow(2, -14) * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + m / 1024);
  }
  return out;
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

function buildShared(S) {
  const pos = new Float32Array(b64(S.pos));
  const nrm = new Int8Array(b64(S.nrm));
  const uv = new Float32Array(b64(S.uv));
  const J = new Uint8Array(b64(S.J));
  const W = new Uint8Array(b64(S.W));
  const idx = new Uint16Array(b64(S.idx));
  const headBones = new Set([S.skel.names.indexOf('Head'), S.skel.names.indexOf('HeadTop_End')]);
  const head = [];
  const body = [];
  const dominant = (v) => {
    let bi = 0, bw = -1;
    for (let k = 0; k < 4; k++) if (W[v * 4 + k] > bw) { bw = W[v * 4 + k]; bi = J[v * 4 + k]; }
    return bi;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const isHead = headBones.has(dominant(a)) && headBones.has(dominant(b)) && headBones.has(dominant(c));
    (isHead ? head : body).push(a, b, c);
  }
  const attrs = {
    position: new THREE.BufferAttribute(pos, 3), normal: new THREE.BufferAttribute(nrm, 3, true), uv: new THREE.BufferAttribute(uv, 2),
    skinIndex: new THREE.BufferAttribute(J, 4), skinWeight: new THREE.BufferAttribute(W, 4, true),
  };
  const mkGeo = (ind) => {
    const g = new THREE.BufferGeometry();
    for (const k of Object.keys(attrs)) g.setAttribute(k, attrs[k]);
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(ind), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 2.6);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-2, -0.2, -2), new THREE.Vector3(2, 2.4, 2));
    return g;
  };
  const tex = new THREE.Texture();
  const img = new Image();
  img.onload = () => { tex.image = img; tex.needsUpdate = true; };
  img.src = SOLDADO_TEX;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.anisotropy = 4;
  const clips = {};
  for (const [name, c] of Object.entries(S.clips)) clips[name] = { n: c.n, fps: c.fps, Q: half(new Uint16Array(b64(c.Q))), H: new Float32Array(b64(c.H)) };
  return { geoBody: mkGeo(body), geoHead: head.length ? mkGeo(head) : null, mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, metalness: 0.08 }), clips };
}

export class SoldadoSkin {
  constructor() {
    const S = SOLDADO;
    this.group = new THREE.Group();
    this.group.name = 'soldado';
    this.holder = new THREE.Group();            // gira PI: o modelo olha +Z, o jogo olha -Z
    this.holder.rotation.y = Math.PI;
    this.holder.scale.setScalar(SCALE);
    this.group.add(this.holder);

    // ossos
    const n = S.skel.names.length;
    this.bones = [];
    this.byName = {};
    for (let i = 0; i < n; i++) {
      const b = new THREE.Bone();
      b.name = S.skel.names[i];
      b.position.fromArray(S.skel.t[i]);
      this.bones.push(b);
      this.byName[b.name] = b;
      const p = S.skel.parent[i];
      if (p >= 0) this.bones[p].add(b); else this.holder.add(b);
    }
    const inv = new Float32Array(b64(S.inv));
    const boneInverses = [];
    for (let i = 0; i < n; i++) boneInverses.push(new THREE.Matrix4().fromArray(inv, i * 16));
    this.skeleton = new THREE.Skeleton(this.bones, boneInverses);
    this._lite = false;

    // geometria/material/clipes sao compartilhados entre todas as instancias (jogador, bots, jogadores online)
    const sh = SoldadoSkin._shared || (SoldadoSkin._shared = buildShared(S));
    this.mat = sh.mat;
    const mkMesh = (geo) => {
      const m = new THREE.SkinnedMesh(geo, this.mat);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      this.holder.add(m);
      m.bind(this.skeleton, new THREE.Matrix4());
      return m;
    };
    this.bodyMesh = mkMesh(sh.geoBody);
    this.headMesh = sh.geoHead ? mkMesh(sh.geoHead) : null;

    this.clips = SoldadoSkin._shared.clips;
    this.nb = n;
    this.phase = 0;
    this.idleT = 0;
    this.runK = 0;
    this.moveK = 0;
    this.hipsRest = S.skel.t[0][1];
    this.acc = new Float32Array(n * 4);
    this.restToeY = 0;
    this.groundOff = 0;
    this._ik = { L: new THREE.Vector3(), R: new THREE.Vector3() };
    this.names = S.skel.names;
    this.I = (nm) => this.names.indexOf(nm);
    this.toeL = this.byName.LeftToe_End;
    this.toeR = this.byName.RightToe_End;
    // altura do dedo na pose de repouso (a partir das matrizes de bind) e pose inicial = 1o quadro do idle
    const toeRest = (nm) => new THREE.Matrix4().copy(boneInverses[this.I(nm)]).invert().elements[13];
    this.restToeY = Math.min(toeRest('LeftToe_End'), toeRest('RightToe_End'));
    const hp = { y: 0 };
    this.acc.fill(0);
    this._accum(this.clips.idle, 0, 1, hp);
    this._pose(hp.y, 0, 0, 0, 0, true);
  }

  /**
   * Atualizacao barata para bots e jogadores online (sem IK nem arma): mistura idle/walk/run por velocidade.
   * o = { crouch, pitch, dead }
   */
  updateLite(dt, speed, o = {}) {
    const moveAmt = smooth(speed / 0.6);
    const runK = clamp((speed - 2.2) / 2.2, 0, 1);
    this.runK += (runK - this.runK) * Math.min(1, 8 * dt);
    this.moveK += (moveAmt - this.moveK) * Math.min(1, 10 * dt);
    const rk = this.runK, mk = this.moveK;
    const cycle = CLIP_DIST.walk + (CLIP_DIST.run - CLIP_DIST.walk) * rk;
    this.phase = (this.phase + (speed * dt) / cycle + 1) % 1;
    this.idleT = (this.idleT + dt / 10.6667) % 1;
    this.acc.fill(0);
    const hips = { y: 0 };
    const wIdle = 1 - mk, wWalk = mk * (1 - rk), wRun = mk * rk;
    if (wIdle > 1e-3) this._accum(this.clips.idle, this.idleT, wIdle, hips);
    if (wWalk > 1e-3) this._accum(this.clips.walk, this.phase, wWalk, hips);
    if (wRun > 1e-3) this._accum(this.clips.run, this.phase, wRun, hips);
    this._pose(hips.y, 0.36 * (o.crouch || 0), 0, 0, 0, true);
    this.holder.updateMatrixWorld(true);
  }

  setShadows(on) {
    this.bodyMesh.castShadow = on;
    if (this.headMesh) this.headMesh.castShadow = on;
  }

  setHeadVisible(v) {
    if (this.headMesh && this.headMesh.visible !== v) this.headMesh.visible = v;
  }

  _toeY(b) {
    b.getWorldPosition(_v);
    this.holder.worldToLocal(_v);
    return _v.y;
  }

  // amostra um clipe em t (0..1) acumulando quaternios ponderados em this.acc
  _accum(clip, u, w, hipsOut) {
    const f = u * clip.n;
    const i0 = Math.floor(f) % clip.n, i1 = (i0 + 1) % clip.n, a = f - Math.floor(f);
    const Q = clip.Q, nb = this.nb;
    const acc = this.acc;
    for (let b = 0; b < nb; b++) {
      const o0 = (i0 * nb + b) * 4, o1 = (i1 * nb + b) * 4;
      let x0 = Q[o0], y0 = Q[o0 + 1], z0 = Q[o0 + 2], w0 = Q[o0 + 3];
      let x1 = Q[o1], y1 = Q[o1 + 1], z1 = Q[o1 + 2], w1 = Q[o1 + 3];
      if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
      let x = x0 + (x1 - x0) * a, y = y0 + (y1 - y0) * a, z = z0 + (z1 - z0) * a, ww = w0 + (w1 - w0) * a;
      const l = Math.hypot(x, y, z, ww) || 1;
      x /= l; y /= l; z /= l; ww /= l;
      const o = b * 4;
      if (acc[o] * x + acc[o + 1] * y + acc[o + 2] * z + acc[o + 3] * ww < 0) { x = -x; y = -y; z = -z; ww = -ww; }
      acc[o] += x * w; acc[o + 1] += y * w; acc[o + 2] += z * w; acc[o + 3] += ww * w;
    }
    hipsOut.y += (clip.H[i0 * 3 + 1] + (clip.H[i1 * 3 + 1] - clip.H[i0 * 3 + 1]) * a) * w;
  }

  // gira o osso (em torno de um eixo do MODELO) mantendo o resto da cadeia do pai
  _add(name, axis, ang) {
    if (Math.abs(ang) < 1e-5) return;
    const b = this.byName[name];
    this.holder.updateMatrixWorld(true);
    b.parent.getWorldQuaternion(_q);
    _q2.copy(_q).multiply(b.quaternion);                       // mundo atual
    this.holder.getWorldQuaternion(_q3);
    _v.copy(axis).applyQuaternion(_q3);
    const r = new THREE.Quaternion().setFromAxisAngle(_v, ang);
    r.multiply(_q2);                                           // novo mundo
    b.quaternion.copy(_q.invert()).multiply(r);
    b.updateMatrixWorld(true);
  }

  // faz o osso apontar (filho) na direcao d (mundo)
  _aim(bone, child, d) {
    bone.getWorldPosition(_v3);
    child.getWorldPosition(_v4);
    _v4.sub(_v3).normalize();
    _q.setFromUnitVectors(_v4, d);
    bone.getWorldQuaternion(_q2);
    _q2.premultiply(_q);
    bone.parent.getWorldQuaternion(_q3);
    bone.quaternion.copy(_q3.invert()).multiply(_q2);
    bone.updateMatrixWorld(true);
  }

  _ikArm(side, target, chestQ, s) {
    const up = this.byName[side + 'Arm'], fo = this.byName[side + 'ForeArm'], ha = this.byName[side + 'Hand'];
    this.holder.updateMatrixWorld(true);
    const S = up.getWorldPosition(new THREE.Vector3());
    const E0 = fo.getWorldPosition(new THREE.Vector3());
    const H0 = ha.getWorldPosition(new THREE.Vector3());
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
    const u = target.clone().sub(S);
    let dist = u.length();
    if (dist < 1e-5) return;
    u.multiplyScalar(1 / dist);
    dist = clamp(dist, Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.003);
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const pole = new THREE.Vector3(s * 0.55, -1, 0.35).applyQuaternion(chestQ);   // cotovelo para baixo e fora
    pole.addScaledVector(u, -pole.dot(u));
    if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0);
    pole.normalize();
    const E = S.clone().addScaledVector(u, L1 * cosA).addScaledVector(pole, L1 * sinA);
    this._aim(up, fo, E.clone().sub(S).normalize());
    const Hn = S.clone().addScaledVector(u, dist);
    this._aim(fo, ha, Hn.sub(E).normalize());
  }

  /** Chamado no fim de Character.update: usa p (parametros) e o proprio Character (alvos de mao, chest). */
  update(dt, p, ch) {
    const sp = p.speed || 0;
    const moveAmt = smooth(sp / 0.6);
    const runK = clamp((sp - 2.2) / 2.2, 0, 1);
    const cr = clamp(ch.crouchK || 0, 0, 1);
    const air = smooth(p.air || 0);
    this.runK += (runK - this.runK) * Math.min(1, 8 * dt);
    this.moveK += (moveAmt - this.moveK) * Math.min(1, 10 * dt);
    const rk = this.runK, mk = this.moveK;

    // direcao do movimento no referencial do corpo (D = frente, direita positiva)
    let psi = 0, dir = 1;
    if (sp > 0.3) {
      psi = Math.atan2(p.lx, p.lz);                 // 0 = frente, +PI/2 = direita
      if (Math.abs(psi) > Math.PI / 2 + 0.05) { dir = -1; psi += psi > 0 ? -Math.PI : Math.PI; }   // de re: anima ao contrario
    }
    this._psi = this._psi === undefined ? 0 : this._psi;
    this._psi += (psi - this._psi) * Math.min(1, 10 * dt);

    // fase do ciclo de passos (por distancia percorrida)
    const cycle = CLIP_DIST.walk + (CLIP_DIST.run - CLIP_DIST.walk) * rk;
    this.phase = (this.phase + dir * (sp * dt) / cycle * (1 - 0.35 * cr) + 1) % 1;
    this.idleT = (this.idleT + dt / 10.6667) % 1;

    // mistura de clipes
    this.acc.fill(0);
    const hips = { y: 0 };
    const wIdle = 1 - mk, wWalk = mk * (1 - rk), wRun = mk * rk;
    if (wIdle > 1e-3) this._accum(this.clips.idle, this.idleT, wIdle, hips);
    if (wWalk > 1e-3) this._accum(this.clips.walk, this.phase, wWalk, hips);
    if (wRun > 1e-3) this._accum(this.clips.run, this.phase, wRun, hips);

    const crouchDrop = 0.36 * cr;
    this._pose(hips.y, crouchDrop, 0, 0, 0, true);

    // ajustes aditivos (eixos do MODELO: X = flexao para frente, Y = giro)
    const lean = rk * mk * 0.16 * (1 - smooth(p.aimBlend || 0)) + 0.22 * cr;
    const twist = clamp(wrap((p.aimYaw || 0) - (p.hipsYaw || 0)), -1.75, 1.75);
    const pitch = p.aimPitch || 0;
    const ps = this._psi * mk;
    if (Math.abs(ps) > 1e-4) this._add('Hips', AY, -ps);               // pernas apontam para onde anda
    this._add('Spine', AX, lean * 0.5 - pitch * 0.10);
    this._add('Spine1', AX, lean * 0.3 - pitch * 0.12);
    this._add('Spine2', AX, lean * 0.2 - pitch * 0.16);
    this._add('Spine', AY, twist * 0.28 + ps * 0.34);
    this._add('Spine1', AY, twist * 0.30 + ps * 0.33);
    this._add('Spine2', AY, twist * 0.42 + ps * 0.33);
    this._add('Head', AX, -pitch * 0.25);
    for (const sd of ['Left', 'Right']) {
      if (cr > 0.01 || air > 0.01) {
        const th = -0.95 * cr - 0.85 * air, sh = 1.6 * cr + 1.1 * air;
        this._add(sd + 'UpLeg', AX, th);
        this._add(sd + 'Leg', AX, sh);
        this._add(sd + 'Foot', AX, -(th + sh) * 0.85);
      }
    }

    // queda livre / paraquedas: pernas dobradas para cima, bracos levantados (segurando as linhas)
    const dk = p.dive || 0, da = p.diveArm || 0;
    // queda livre: rotacoes simples nos eixos do MODELO (X = esquerda-direita, Z = frente). Sem IK, sem "menor arco": nada gira torto.
    if (dk > 0.01) {
      this._add('Spine2', AX, -0.18 * dk);                 // peito levemente arqueado
      this._add('Head', AX, -0.8 * dk);                    // cabeca erguida olhando para frente
      for (const sd of ['Left', 'Right']) {
        this._add(sd + 'UpLeg', AX, 0.45 * dk);            // coxas para tras
        this._add(sd + 'Leg', AX, 1.6 * dk);               // joelhos dobrados: canelas para cima
        this._add(sd + 'Foot', AX, 0.35 * dk);
      }
    }
    if (da > 0.01) {
      for (const sd of ['Left', 'Right']) {
        this._add(sd + 'Arm', AX, -2.85 * da);             // braco inteiro para cima (e um pouco para frente)
        this._add(sd + 'Arm', AZ, (sd === 'Right' ? 0.30 : -0.30) * da);   // levemente aberto
        this._add(sd + 'ForeArm', AX, -0.45 * da);         // cotovelo um pouco dobrado: maos nas linhas
      }
    }

    // maos na arma (IK) quando armado; desarmado usa os bracos da animacao
    this.holder.updateMatrixWorld(true);
    if (p.rig && ch._rTarget && ch._lTarget) {
      ch.bones.chest.getWorldQuaternion(_q3);
      const cq = _q3.clone();
      // a orientacao da mao da animacao (fuzil seguro) e guardada e devolvida depois do IK: maos nao ficam tortas
      const hand0 = {};
      for (const sd of ['Right', 'Left']) hand0[sd] = this.byName[sd + 'Hand'].getWorldQuaternion(new THREE.Quaternion());
      this._ikArm('Right', ch._rTarget, cq, 1);
      this._ikArm('Left', ch._lTarget, cq, -1);
      for (const sd of ['Right', 'Left']) {
        const ha = this.byName[sd + 'Hand'];
        ha.parent.getWorldQuaternion(_q2);
        ha.quaternion.copy(_q2.invert()).multiply(hand0[sd]);
        ha.updateMatrixWorld(true);
      }
      this.holder.updateMatrixWorld(true);
    }

    // contato com o chao: empurra para cima se os pes entram no piso; agachado/ar acompanha
    const toe = Math.min(this._toeY(this.toeL), this._toeY(this.toeR));
    const need = (this.restToeY - toe) * SCALE;
    const target = (cr > 0.01 && air < 0.5) ? need * (0.5 + 0.5 * cr) : Math.max(0, need);
    this.groundOff += (clamp(target, -0.5, 0.5) - this.groundOff) * Math.min(1, 18 * dt);
    this.holder.position.y = this.groundOff;
    this.holder.updateMatrixWorld(true);
  }

  _pose(hipsY, drop, _a, _b, _c, fromAcc) {
    const nb = this.nb, acc = this.acc;
    for (let b = 0; b < nb; b++) {
      const o = b * 4;
      const bone = this.bones[b];
      if (fromAcc) {
        const l = Math.hypot(acc[o], acc[o + 1], acc[o + 2], acc[o + 3]) || 1;
        bone.quaternion.set(acc[o] / l, acc[o + 1] / l, acc[o + 2] / l, acc[o + 3] / l);
      } else {
        bone.quaternion.set(0, 0, 0, 1);
      }
    }
    const h = this.bones[0];
    h.position.set(SOLDADO.skel.t[0][0], fromAcc ? hipsY - drop : this.hipsRest, SOLDADO.skel.t[0][2]);
    h.updateMatrixWorld(true);
  }
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
