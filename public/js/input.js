// Entrada: teclado + mouse (pointer lock) no computador e controles por toque no celular.
// Expone um estado simples consultado a cada quadro (`state`) e eventos de acao (`actions`).
const TAU = Math.PI * 2;

export class Input {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui; // { joystick, joyKnob, lookZone, btnFire, btnAim, btnReload, btnSwap, btnJump? }
    this.keys = new Set();
    this.look = { dx: 0, dy: 0 };
    this.move = { x: 0, y: 0 };          // x: direita +, y: frente +
    this.fire = false;                    // gatilho mantido
    this.firePressed = false;             // borda de subida (1 quadro)
    this.aim = false;
    this.aimMode = 'toggle';              // 'toggle' = a mira fica travada ate tocar de novo; 'hold' = so enquanto segura
    this.run = false;
    this.runToggle = false;               // botao CORRER (toque): liga/desliga
    this.actions = [];                    // 'reload' | 'swap' | 'w1' | 'w2' | 'pause' | 'restart'
    this.touch = false;
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 0.0022;
    this.touchSensitivity = 0.0052;
    this._touchState = new Map();
    this._joyId = null;
    this._lookId = null;
    this._joyCenter = { x: 0, y: 0 };
    this._joyRadius = 54;
    this._mouseButtons = 0;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.releaseAll());

    const cv = this.canvas;
    cv.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touch) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) { this.fire = true; this.firePressed = true; }
      if (e.button === 2) this.aim = this.aimMode === 'toggle' ? !this.aim : true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2 && this.aimMode === 'hold') this.aim = false;
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || !this.locked) return;
      this.look.dx += e.movementX || 0;
      this.look.dy += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.fire = false; this.aim = false; if (this.onUnlock) this.onUnlock(); }
    });
    window.addEventListener('wheel', (e) => {
      if (!this.enabled || !this.locked) return;
      const now = performance.now();
      if (now - (this._lastWheel || 0) < 250) return; // um giro de roda = uma troca
      this._lastWheel = now;
      this.actions.push('swap');
    }, { passive: true });

    this._bindTouch();
  }

  requestLock() {
    if (this.touch) return;
    const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _key(e, down) {
    const code = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code) && this.enabled) e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.keys.add(code);
      if (!this.enabled) return;
      if (code === 'KeyR') this.actions.push('reload');
      else if (/^Digit[1-8]$/.test(code)) this.actions.push('w' + code.slice(5));
      else if (code === 'Digit9' || code === 'KeyH') this.actions.push('hands');
      else if (code === 'KeyQ') this.actions.push('swap');
      else if (code === 'KeyP') this.actions.push('pause');
      else if (code === 'KeyT') this.actions.push('restart');
      else if (code === 'KeyC') this.actions.push('crouch');
      else if (code === 'KeyZ') this.actions.push('prone');
      else if (code === 'KeyF') this.actions.push('heal');
      else if (code === 'KeyG') this.actions.push('frag');
      else if (code === 'KeyV') this.actions.push('gel');
      else if (code === 'KeyB' || code === 'Tab') { this.actions.push('pack'); e.preventDefault && e.preventDefault(); }
      else if (code === 'Space') this.actions.push('jump');
    } else {
      this.keys.delete(code);
    }
  }

  releaseAll() {
    this.keys.clear();
    this.fire = false;
    this.aim = false;
    this.look.dx = 0; this.look.dy = 0;
    this.actions = [];
    this.move.x = 0; this.move.y = 0;
    this._touchState.clear();
    this._joyId = null;
    this._lookId = null;
    if (this.ui.joyKnob) this.ui.joyKnob.style.transform = 'translate(0px, 0px)';
  }

  // ------------------------------------------------------------------ toque
  _bindTouch() {
    const u = this.ui;
    const opts = { passive: false };
    const stop = (e) => { if (e.cancelable) e.preventDefault(); };

    // joystick virtual (area esquerda)
    u.joystick.addEventListener('touchstart', (e) => {
      stop(e);
      this.touch = true;
      if (this._joyId !== null) return;
      const t = e.changedTouches[0];
      this._joyId = t.identifier;
      const r = u.joystick.getBoundingClientRect();
      this._joyCenter.x = r.left + r.width / 2;
      this._joyCenter.y = r.top + r.height / 2;
      this._joyRadius = r.width * 0.36;
      this._joyMove(t);
    }, opts);
    u.joystick.addEventListener('touchmove', (e) => {
      stop(e);
      for (const t of e.changedTouches) if (t.identifier === this._joyId) this._joyMove(t);
    }, opts);
    const joyEnd = (e) => {
      stop(e);
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyId) {
          this._joyId = null;
          this.move.x = 0; this.move.y = 0;
          this.run = false;
          u.joyKnob.style.transform = 'translate(0px, 0px)';
        }
      }
    };
    u.joystick.addEventListener('touchend', joyEnd, opts);
    u.joystick.addEventListener('touchcancel', joyEnd, opts);

    // area de camera (resto da tela)
    u.lookZone.addEventListener('touchstart', (e) => {
      stop(e);
      this.touch = true;
      if (this._lookId !== null) return;
      const t = e.changedTouches[0];
      this._lookId = t.identifier;
      this._touchState.set(t.identifier, { x: t.clientX, y: t.clientY });
    }, opts);
    u.lookZone.addEventListener('touchmove', (e) => {
      stop(e);
      for (const t of e.changedTouches) {
        if (t.identifier !== this._lookId) continue;
        const p = this._touchState.get(t.identifier);
        if (!p) continue;
        this.look.dx += (t.clientX - p.x) * (this.touchSensitivity / this.sensitivity);
        this.look.dy += (t.clientY - p.y) * (this.touchSensitivity / this.sensitivity);
        p.x = t.clientX; p.y = t.clientY;
      }
    }, opts);
    const lookEnd = (e) => {
      stop(e);
      for (const t of e.changedTouches) if (t.identifier === this._lookId) { this._lookId = null; this._touchState.delete(t.identifier); }
    };
    u.lookZone.addEventListener('touchend', lookEnd, opts);
    u.lookZone.addEventListener('touchcancel', lookEnd, opts);

    // botoes
    // slide: o dedo que segura o botao tambem move a camera (ex.: segurar FOGO e deslizar para cima para mirar mais alto)
    const hold = (el, on, off, slide = false) => {
      let tid = null;
      let lx = 0;
      let ly = 0;
      el.addEventListener('touchstart', (e) => {
        stop(e); this.touch = true; el.classList.add('down'); on();
        if (slide && tid === null) { const t = e.changedTouches[0]; tid = t.identifier; lx = t.clientX; ly = t.clientY; }
      }, opts);
      if (slide) {
        el.addEventListener('touchmove', (e) => {
          stop(e);
          for (const t of e.changedTouches) {
            if (t.identifier !== tid) continue;
            const k = this.touchSensitivity / this.sensitivity;
            this.look.dx += (t.clientX - lx) * k;
            this.look.dy += (t.clientY - ly) * k;
            lx = t.clientX; ly = t.clientY;
          }
        }, opts);
      }
      const up = (e) => {
        stop(e); el.classList.remove('down'); off();
        for (const t of e.changedTouches) if (t.identifier === tid) tid = null;
      };
      el.addEventListener('touchend', up, opts);
      el.addEventListener('touchcancel', up, opts);
    };
    hold(u.btnFire, () => { this.fire = true; this.firePressed = true; }, () => { this.fire = false; }, true);
    if (u.btnFire2) hold(u.btnFire2, () => { this.fire = true; this.firePressed = true; }, () => { this.fire = false; }, true);
    if (u.btnJump) hold(u.btnJump, () => this.actions.push('jump'), () => {});
    if (u.btnCrouch) hold(u.btnCrouch, () => this.actions.push('crouch'), () => {});
    if (u.btnProne) hold(u.btnProne, () => this.actions.push('prone'), () => {});
    if (u.btnRun) {
      hold(u.btnRun, () => { this.runToggle = !this.runToggle; u.btnRun.classList.toggle('on', this.runToggle); }, () => {});
    }
    hold(u.btnAim, () => { this.aim = this.aimMode === 'toggle' ? !this.aim : true; }, () => { if (this.aimMode === 'hold') this.aim = false; }, true);
    hold(u.btnReload, () => this.actions.push('reload'), () => {});
    hold(u.btnSwap, () => this.actions.push('swap'), () => {});
    for (const [k, a] of [['btnHeal', 'heal'], ['btnFrag', 'frag'], ['btnGel', 'gel'], ['btnPack', 'pack']]) if (u[k]) hold(u[k], () => this.actions.push(a), () => {});
  }

  _joyMove(t) {
    const dx = t.clientX - this._joyCenter.x;
    const dy = t.clientY - this._joyCenter.y;
    const d = Math.hypot(dx, dy);
    const k = d > this._joyRadius ? this._joyRadius / d : 1;
    const x = dx * k;
    const y = dy * k;
    this.ui.joyKnob.style.transform = `translate(${x}px, ${y}px)`;
    let nx = x / this._joyRadius;
    let ny = -y / this._joyRadius;
    const m = Math.hypot(nx, ny);
    const dead = 0.12;
    if (m < dead) { nx = 0; ny = 0; } else {
      const s = (m - dead) / (1 - dead) / m;
      nx *= s; ny *= s;
    }
    this.move.x = nx;
    this.move.y = ny;
    this.run = m > 0.9;
  }

  // ------------------------------------------------------------------ consulta por quadro
  /** Vetor de movimento (x direita, y frente) combinando teclado e joystick. */
  readMove(out) {
    let x = this.move.x;
    let y = this.move.y;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    out.x = x; out.y = y;
    return out;
  }

  get sprint() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.run || this.runToggle;
  }

  /** Consome o delta de camera acumulado. */
  takeLook(out) {
    out.x = this.look.dx; out.y = this.look.dy;
    this.look.dx = 0; this.look.dy = 0;
    return out;
  }

  takeActions() {
    if (!this.actions.length) return null;
    const a = this.actions;
    this.actions = [];
    return a;
  }

  takeFirePressed() {
    const v = this.firePressed;
    this.firePressed = false;
    return v;
  }
}

export { TAU };
