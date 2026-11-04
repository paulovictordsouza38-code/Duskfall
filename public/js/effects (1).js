// Efeitos de disparo: clarao discreto na boca do cano, rastro do projetil, marcas de impacto e fagulhas.
// Tudo em pools (nenhum objeto novo e criado durante o jogo).
import * as THREE from 'three';

const Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();

export class Effects {
  constructor(scene, lib) {
    this.scene = scene;

    // ---- clarao
    this.flashMat = new THREE.SpriteMaterial({
      map: lib.flashTexture(),
      color: 0xffe0a0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xffb468, 0, 9, 2);
    this._blastLight = new THREE.PointLight(0xff9b50, 0, 22, 2);   // criada ja no inicio: criar luz no meio do jogo trava (recompila shaders)
    scene.add(this._blastLight);
    this.lite = false;
    this.flashT = 0;
    this.flashScale = 1;
    scene.add(this.flash, this.flashLight);

    // ---- rastros
    this.tracerGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 5, 1, true);
    this.tracerGeo.rotateX(Math.PI / 2);
    this.tracerGeo.translate(0, 0, -0.5); // origem na ponta inicial, estica ao longo de -Z
    this.tracers = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        this.tracerGeo,
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      m.visible = false;
      m.frustumCulled = false;
      m.userData.life = 0;
      scene.add(m);
      this.tracers.push(m);
    }
    this.tracerIdx = 0;

    // ---- marcas de impacto
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalMat = new THREE.MeshBasicMaterial({
      map: lib.bulletHole(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.decals = [];
    for (let i = 0; i < 64; i++) {
      const d = new THREE.Mesh(this.decalGeo, this.decalMat);
      d.visible = false;
      scene.add(d);
      this.decals.push(d);
    }
    this.decalIdx = 0;

    // ---- fagulhas
    this.sparkMat = new THREE.SpriteMaterial({
      map: lib.flashTexture(),
      color: 0xffc070,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.sparks = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(this.sparkMat.clone());
      s.visible = false;
      s.userData.life = 0;
      scene.add(s);
      this.sparks.push(s);
    }
    this.sparkIdx = 0;
  }

  /** Fixa o clarao e a luz na boca do cano da arma ativa. */
  attachMuzzle(muzzleObj, scale = 1) {
    this.flashScale = scale;
    muzzleObj.add(this.flash, this.flashLight);
    this.flash.position.set(0, 0, -0.02);
    this.flashLight.position.set(0, 0, -0.08);
  }

  fire(muzzleWorld, endWorld) {
    this.flashT = 0.045;
    this.flash.visible = true;
    const s = (0.16 + Math.random() * 0.08) * this.flashScale;
    this.flash.scale.set(s, s, 1);
    this.flashMat.rotation = Math.random() * Math.PI * 2;
    this.flashLight.intensity = 5 * this.flashScale;

    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    t.position.copy(muzzleWorld);
    _v.subVectors(endWorld, muzzleWorld);
    const len = _v.length();
    if (len < 0.05) { t.visible = false; return; }
    t.scale.set(1, 1, len);
    t.lookAt(endWorld); // eixo -Z aponta para o ponto final
    t.rotateY(Math.PI); // geometria estica em -Z local: inverte para apontar ao alvo
    t.material.opacity = 0.75;
    t.userData.life = 0.06;
    t.visible = true;
  }

  /** So o rastro (bots e jogadores online): sem clarao da arma do jogador. */
  tracer(a, b) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    t.position.copy(a);
    _v.subVectors(b, a);
    const len = _v.length();
    if (len < 0.05) { t.visible = false; return; }
    t.scale.set(1, 1, len);
    t.lookAt(b);
    t.rotateY(Math.PI);
    t.material.opacity = 0.55;
    t.userData.life = 0.07;
    t.visible = true;
  }

  /** Modo leve: sem luzes de clarao e de explosao (menos custo por pixel). */
  setLite(on) {
    this.lite = on;
    this.flashLight.visible = !on;
    this._blastLight.visible = !on;
  }

  /** Explosao: bola de fogo + onda + luz (pool pequeno). */
  blast(p, radius = 6) {
    if (!this._blasts) {
      this._blasts = [];
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkMat.map, color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
        const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkMat.map, color: 0x2a2623, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
        const l = this._blastLight;
        m.visible = false; smoke.visible = false;
        this.scene.add(m, smoke);
        this._blasts.push({ m, smoke, l, t: 0, r: 1, active: false });
      }
      this._blastIdx = 0;
    }
    const b = this._blasts[this._blastIdx];
    this._blastIdx = (this._blastIdx + 1) % this._blasts.length;
    b.active = true; b.t = 0; b.r = radius;
    b.m.position.copy(p); b.m.position.y += 0.6;
    b.smoke.position.copy(b.m.position);
    b.l.position.copy(b.m.position);
    b.m.visible = true; b.smoke.visible = true;
  }

  /**
   * @param {THREE.Vector3} point  ponto no mundo
   * @param {THREE.Vector3} normal normal no mundo (normalizada)
   * @param {THREE.Object3D} object objeto atingido (a marca acompanha alvos que se movem)
   */
  impact(point, normal, object, size = 0.06, spark = true) {
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    this.scene.attach(d); // solta do pai anterior (se estava num alvo)
    d.position.copy(point).addScaledVector(normal, 0.003);
    _q.setFromUnitVectors(Z, normal);
    _qr.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
    d.quaternion.copy(_q).multiply(_qr);
    const s = size * (0.85 + Math.random() * 0.3);
    d.scale.set(s, s, 1);
    d.visible = true;
    if (object && object !== this.scene) {
      object.updateWorldMatrix(true, false);
      object.attach(d);
    }
    if (spark) {
      const sp = this.sparks[this.sparkIdx];
      this.sparkIdx = (this.sparkIdx + 1) % this.sparks.length;
      sp.position.copy(point).addScaledVector(normal, 0.02);
      sp.scale.set(0.03, 0.03, 1);
      sp.material.opacity = 0.9;
      sp.userData.life = 0.1;
      sp.visible = true;
    }
  }

  clearDecals() {
    for (const d of this.decals) {
      this.scene.attach(d);
      d.visible = false;
    }
    this.decalIdx = 0;
  }

  update(dt) {
    if (this._blasts) {
      let li = 0;
      for (const b of this._blasts) {
        if (!b.active) continue;
        b.t += dt;
        const k = b.t / 0.9;
        if (k >= 1) { b.active = false; b.m.visible = false; b.smoke.visible = false; continue; }
        const e = 1 - Math.pow(1 - Math.min(1, k * 2.2), 2);
        const sz = b.r * (0.5 + 1.4 * e);
        b.m.scale.set(sz, sz, 1);
        b.m.material.opacity = Math.max(0, 1 - k * 1.3);
        b.smoke.scale.set(sz * 1.2, sz * 1.2, 1);
        b.smoke.position.y += dt * 1.4;
        b.smoke.material.opacity = Math.min(0.55, k * 3) * (1 - k);
        li = Math.max(li, 90 * Math.max(0, 1 - k * 2.6));
      }
      this._blastLight.intensity = li;
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      } else {
        this.flashLight.intensity *= 0.8;
      }
    }
    for (const t of this.tracers) {
      if (!t.visible) continue;
      t.userData.life -= dt;
      if (t.userData.life <= 0) t.visible = false;
      else t.material.opacity = (t.userData.life / 0.06) * 0.75;
    }
    for (const s of this.sparks) {
      if (!s.visible) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { s.visible = false; continue; }
      const k = s.userData.life / 0.1;
      const sc = 0.03 + (1 - k) * 0.09;
      s.scale.set(sc, sc, 1);
      s.material.opacity = k * 0.9;
    }
  }
}
