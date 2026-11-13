// Personalizacao do HUD: o jogador arrasta cada botao/painel e ajusta o tamanho.
// As posicoes ficam salvas no aparelho (localStorage) como fracao da tela, entao valem em qualquer resolucao.
const KEY = 'sala_hud_v2';
export const HUD_IDS = ['joystick', 'btnFire', 'btnFire2', 'btnAim', 'btnCrouch', 'btnProne', 'btnRun', 'btnJump', 'itemBtns', 'vitals', 'stats', 'ammo', 'topbtns'];
const NAMES = {
  joystick: 'Joystick', btnFire: 'Fogo', btnFire2: 'Fogo (esquerda)', btnCrouch: 'Agachar', btnProne: 'Deitar', btnJump: 'Pular', btnRun: 'Correr', btnAim: 'Mirar',
  itemBtns: 'Itens (curar/granadas/mochila)', vitals: 'Vida HP/EP', stats: 'Pontuação', ammo: 'Munição', topbtns: 'Pausar/Reiniciar',
};

function load() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}

export class HudLayout {
  constructor({ onEnter, onExit } = {}) {
    this.cfg = load();
    this.editing = false;
    this.sel = null;
    this.drag = null;
    this.onEnter = onEnter;
    this.onExit = onExit;
    this.els = {};
    for (const id of HUD_IDS) this.els[id] = document.getElementById(id);
    this.bar = document.getElementById('editBar');
    this.slider = document.getElementById('hudSize');
    this.label = document.getElementById('editSel');
    this.apply();
    window.addEventListener('resize', () => this.apply());
    window.addEventListener('orientationchange', () => setTimeout(() => this.apply(), 250));
    this._bindEdit();
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.cfg)); } catch (e) { /* sem storage */ }
  }

  _place(el, c) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = Math.round(c.x * w) + 'px';
    el.style.top = Math.round(c.y * h) + 'px';
    el.style.transformOrigin = 'top left';
    el.style.transform = c.s && c.s !== 1 ? `scale(${c.s})` : '';
  }

  _clamp(el) {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let dx = 0;
    let dy = 0;
    if (r.left < 4) dx = 4 - r.left;
    if (r.right > w - 4) dx = w - 4 - r.right;
    if (r.top < 4) dy = 4 - r.top;
    if (r.bottom > h - 4) dy = h - 4 - r.bottom;
    if (dx || dy) {
      el.style.left = Math.round(parseFloat(el.style.left) + dx) + 'px';
      el.style.top = Math.round(parseFloat(el.style.top) + dy) + 'px';
    }
  }

  apply() {
    for (const id of HUD_IDS) {
      const c = this.cfg[id];
      const el = this.els[id];
      if (!c || !el) continue;
      this._place(el, c);
      // so mede quando visivel (os botoes de toque ficam ocultos no computador)
      if (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') this._clamp(el);
    }
  }

  _store(id) {
    const el = this.els[id];
    const r = el.getBoundingClientRect();
    const s = (this.cfg[id] && this.cfg[id].s) || 1;
    // left/top do estilo (nao do rect) para o scale com origem no canto superior esquerdo continuar valendo
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    this.cfg[id] = { x: (isNaN(left) ? r.left : left) / window.innerWidth, y: (isNaN(top) ? r.top : top) / window.innerHeight, s };
  }

  reset() {
    for (const id of HUD_IDS) {
      const el = this.els[id];
      if (!el) continue;
      el.style.left = el.style.top = el.style.right = el.style.bottom = el.style.transform = el.style.transformOrigin = '';
    }
    this.cfg = {};
    this.save();
    this.select(null);
  }

  select(id) {
    if (this.sel) this.els[this.sel].classList.remove('sel');
    this.sel = id;
    if (id) {
      this.els[id].classList.add('sel');
      this.slider.disabled = false;
      this.slider.value = String((this.cfg[id] && this.cfg[id].s) || 1);
      this.label.textContent = NAMES[id];
    } else {
      this.slider.disabled = true;
      this.label.textContent = 'Toque num botão para escolher';
    }
  }

  enter() {
    this.editing = true;
    document.body.classList.add('editing');
    // posiciona de forma absoluta os itens ainda sem posicao salva (para poder arrastar)
    for (const id of HUD_IDS) {
      const el = this.els[id];
      if (!el || this.cfg[id]) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.left = Math.round(r.left) + 'px';
      el.style.top = Math.round(r.top) + 'px';
      el.style.transformOrigin = 'top left';
    }
    this.select(null);
    if (this.onEnter) this.onEnter();
  }

  exit() {
    this.editing = false;
    this.drag = null;
    document.body.classList.remove('editing');
    this.select(null);
    this.save();
    if (this.onExit) this.onExit();
  }

  _hit(target) {
    for (const id of HUD_IDS) {
      const el = this.els[id];
      if (el && el.contains(target)) return id;
    }
    return null;
  }

  _down(x, y, target) {
    const id = this._hit(target);
    if (!id) return false;
    const el = this.els[id];
    const r = el.getBoundingClientRect();
    this.select(id);
    this.drag = { id, ox: x - r.left, oy: y - r.top, left0: parseFloat(el.style.left) || r.left, top0: parseFloat(el.style.top) || r.top, rx: r.left, ry: r.top };
    return true;
  }

  _move(x, y) {
    const d = this.drag;
    if (!d) return;
    const el = this.els[d.id];
    const r = el.getBoundingClientRect();
    // deslocamento desejado em relacao ao canto atual
    const wantLeft = x - d.ox;
    const wantTop = y - d.oy;
    el.style.left = Math.round(parseFloat(el.style.left) + (wantLeft - r.left)) + 'px';
    el.style.top = Math.round(parseFloat(el.style.top) + (wantTop - r.top)) + 'px';
    this._clamp(el);
  }

  _up() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this._store(d.id);
    this.save();
  }

  _bindEdit() {
    const cap = { capture: true, passive: false };
    const mine = (e) => this.editing && !(e.target.closest && e.target.closest('#editBar'));

    document.addEventListener('touchstart', (e) => {
      if (!mine(e)) return;
      const t = e.changedTouches[0];
      if (this._down(t.clientX, t.clientY, e.target)) { e.stopPropagation(); e.preventDefault(); }
      else { e.stopPropagation(); e.preventDefault(); this.select(null); }
    }, cap);
    document.addEventListener('touchmove', (e) => {
      if (!this.editing) return;
      if (this.drag) { const t = e.changedTouches[0]; this._move(t.clientX, t.clientY); }
      if (mine(e)) { e.stopPropagation(); e.preventDefault(); }
    }, cap);
    const end = (e) => {
      if (!this.editing) return;
      this._up();
      if (mine(e)) { e.stopPropagation(); e.preventDefault(); }
    };
    document.addEventListener('touchend', end, cap);
    document.addEventListener('touchcancel', end, cap);

    document.addEventListener('mousedown', (e) => {
      if (!mine(e)) return;
      if (this._down(e.clientX, e.clientY, e.target)) { e.stopPropagation(); e.preventDefault(); }
      else { e.stopPropagation(); this.select(null); }
    }, cap);
    window.addEventListener('mousemove', (e) => { if (this.editing && this.drag) this._move(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { if (this.editing) this._up(); });
    // cliques nos botoes do jogo nao devem disparar acoes durante a edicao
    document.addEventListener('click', (e) => {
      if (mine(e) && this._hit(e.target)) { e.stopPropagation(); e.preventDefault(); }
    }, cap);

    this.slider.addEventListener('input', () => {
      if (!this.sel) return;
      const el = this.els[this.sel];
      const s = parseFloat(this.slider.value);
      this.cfg[this.sel] = Object.assign(this.cfg[this.sel] || {}, { s });
      el.style.transformOrigin = 'top left';
      el.style.transform = s !== 1 ? `scale(${s})` : '';
      this._clamp(el);
      this._store(this.sel);
      this.cfg[this.sel].s = s;
      this.save();
    });
    document.getElementById('btnEditDone').addEventListener('click', () => this.exit());
    document.getElementById('btnEditReset').addEventListener('click', () => this.reset());
  }
}
