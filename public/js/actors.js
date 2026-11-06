// Atores (bots e jogadores online): o mesmo operador do jogo + arma + marcador (inimigo = triangulo vermelho, amigo = apelido).
import * as THREE from 'three';
import { SoldadoSkin } from './soldado.js';

let _tagCache = new Map();
function nameTexture(text, color = '#7dffa0') {
  const key = color + text;
  if (_tagCache.has(key)) return _tagCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Rajdhani, Arial Narrow, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.85)';
  g.strokeText(text, 128, 34);
  g.fillStyle = color;
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _tagCache.set(key, t);
  return t;
}

let _tri = null;
function enemyMarker() {
  if (!_tri) {
    const geo = new THREE.ConeGeometry(0.17, 0.3, 3);
    geo.rotateX(Math.PI);                                              // ponta para baixo
    _tri = { geo, mat: new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false, depthTest: false, transparent: true, opacity: 0.95 }) };
  }
  const m = new THREE.Mesh(_tri.geo, _tri.mat);
  m.renderOrder = 20;
  return m;
}

export class Actor {
  /** @param {object} o { makeRig(id), shadows } */
  constructor(o) {
    this.o = o;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.skin = new SoldadoSkin();
    this.skin.setShadows(!!o.shadows);
    this.root.add(this.skin.group);
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.pitch = 0;
    this.speed = 0; this.crouch = 0;
    this.hp = 200; this.alive = true; this.team = 0; this.id = null; this.name = '';
    this.role = 'enemy';
    this.marker = null; this.tag = null; this.rig = null; this.weaponId = null;
    this.fall = 0;
  }

  setRole(role, name = '') {
    this.role = role;
    this.name = name;
    if (this.marker) { this.root.remove(this.marker); this.marker = null; }
    if (this.tag) { this.root.remove(this.tag); this.tag = null; }
    if (role === 'enemy') {
      this.marker = enemyMarker();
      this.marker.position.y = 2.25;
      this.root.add(this.marker);
      if (name) {                                                    // nome do oponente em cima do personagem
        this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name, '#ff7a6a'), depthTest: false, transparent: true, toneMapped: false }));
        this.tag.scale.set(1.6, 0.4, 1);
        this.tag.position.y = 2.65;
        this.tag.renderOrder = 20;
        this.root.add(this.tag);
      }
    } else {
      this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name || 'Amigo'), depthTest: false, transparent: true, toneMapped: false }));
      this.tag.scale.set(1.6, 0.4, 1);
      this.tag.position.y = 2.3;
      this.tag.renderOrder = 20;
      this.root.add(this.tag);
    }
  }

  setWeapon(id) {
    if (this.weaponId === id) return;
    this.weaponId = id;
    if (this.rig) this.root.remove(this.rig.group);
    this.rig = id ? this.o.makeRig(id) : null;
    if (this.rig) {
      this.rig.group.visible = true;
      this.root.add(this.rig.group);
      this._placeWeapon();
    }
  }

  _placeWeapon() {
    if (!this.rig) return;
    const c = this.rig.carry.pos;
    this.rig.group.position.set(c[0], 1.22 + c[1] * 0.55, c[2] + 0.05);
    this.rig.group.rotation.set(this.pitch * 0.6, 0, 0);
  }

  place(x, y, z, yaw) { this.x = x; this.y = y; this.z = z; this.yaw = yaw; this.root.position.set(x, y, z); this.root.rotation.y = yaw; }

  /** Muzzle no mundo (para rastro). */
  muzzleWorld(out) {
    if (this.rig) { this.rig.muzzle.getWorldPosition(out); return out; }
    return out.set(this.x, this.y + 1.4, this.z);
  }

  update(dt, t) {
    if (!this.alive) { this._dying(dt); return; }
    this.skin.updateLite(dt, this.speed, { crouch: this.crouch });
    this._placeWeapon();
    if (this.marker) this.marker.position.y = 2.25 + Math.sin(t * 4 + this.x) * 0.05;
  }

  die() {
    this.alive = false;
    this.dyingT = 0;
    if (this.marker) this.marker.visible = false;
    if (this.tag) this.tag.visible = false;
  }
  revive() {
    this.alive = true;
    this.root.rotation.x = 0;
    this.root.visible = true;
    this.skin.group.position.y = 0;
    if (this.marker) this.marker.visible = true;
    if (this.tag) this.tag.visible = true;
  }
  _dying(dt) {
    this.dyingT += dt;
    const k = Math.min(1, this.dyingT / 0.45);
    this.root.rotation.x = -Math.PI / 2 * k * 0.97;                    // cai para tras
    this.root.position.y = this.y + 0.2 * k;
    if (this.rig) this.rig.group.visible = k < 0.2;
    if (this.dyingT > 5) this.root.visible = false;
  }
}
