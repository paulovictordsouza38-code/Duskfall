// Audio sintetizado com Web Audio (sem arquivos externos). Sons provisorios:
// disparo (USP e MP40 diferentes), recarga, clique sem municao, impactos, passos.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.reverb = null;
    this.noiseBuf = null;
    this.muted = false;
    this.volume = 0.7;
  }

  /** Precisa ser chamado dentro de um gesto do usuario (toque/clique). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { this.ctx = new AC(); } catch (e) { return false; }
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      // reverb curta de sala (impulso de ruido decrescente)
      const len = Math.floor(ctx.sampleRate * 0.9);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      conv.connect(wet);
      wet.connect(this.master);
      this.reverb = conv;

      const nl = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
      const nd = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running' && !this.muted; }

  _out(node, reverbAmt) {
    node.connect(this.master);
    if (reverbAmt > 0) {
      const send = this.ctx.createGain();
      send.gain.value = reverbAmt;
      node.connect(send);
      send.connect(this.reverb);
    }
  }

  _burst({ when = 0, dur = 0.1, gain = 0.5, hp = 0, lp = 8000, bp = 0, q = 1, rev = 0.3, offset = -1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    let node = src;
    if (hp > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    if (bp > 0) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = q; node.connect(f); node = f; }
    if (lp < 20000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    this._out(g, rev);
    src.start(t, offset >= 0 ? offset : Math.random() * 0.5, dur + 0.05);
  }

  _tone({ when = 0, f0 = 200, f1 = 60, dur = 0.1, gain = 0.5, type = 'sine', rev = 0.2 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    this._out(g, rev);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(id, kind = 'pistol') {
    if (!this.ready) return;
    const r = 0.92 + Math.random() * 0.16;
    if (id === 'usp') {
      this._burst({ dur: 0.16, gain: 0.55, hp: 500, lp: 7000 * r, rev: 0.5 });
      this._burst({ dur: 0.02, gain: 0.5, hp: 3500, lp: 12000, rev: 0.1 });
      this._tone({ f0: 150 * r, f1: 48, dur: 0.14, gain: 0.7, rev: 0.4 });
    } else if (kind === 'sniper') {
      this._burst({ dur: 0.5, gain: 0.8, hp: 120, lp: 5000 * r, rev: 0.9 });
      this._burst({ dur: 0.03, gain: 0.7, hp: 2500, lp: 12000, rev: 0.2 });
      this._tone({ f0: 90 * r, f1: 28, dur: 0.35, gain: 0.95, rev: 0.7 });
      this._tone({ when: 0.55, f0: 600, f1: 380, dur: 0.05, gain: 0.12, type: 'square', rev: 0.2 });   // ferrolho
    } else if (kind === 'rifle') {
      this._burst({ dur: 0.2, gain: 0.6, hp: 250, lp: 6000 * r, rev: 0.6 });
      this._burst({ dur: 0.018, gain: 0.5, hp: 3200, lp: 12000, rev: 0.12 });
      this._tone({ f0: 105 * r, f1: 36, dur: 0.16, gain: 0.8, rev: 0.5 });
    } else {
      this._burst({ dur: 0.11, gain: 0.5, bp: 1700 * r, q: 0.7, lp: 6500, rev: 0.45 });
      this._burst({ dur: 0.015, gain: 0.45, hp: 3000, lp: 11000, rev: 0.1 });
      this._tone({ f0: 115 * r, f1: 42, dur: 0.1, gain: 0.6, rev: 0.35 });
      this._tone({ f0: 320, f1: 140, dur: 0.05, gain: 0.12, type: 'square', rev: 0.1 });
    }
  }

  explosion() {
    if (!this.ready) return;
    this._burst({ dur: 0.9, gain: 0.95, hp: 40, lp: 2600, rev: 0.9 });
    this._burst({ dur: 0.05, gain: 0.7, hp: 1500, lp: 9000, rev: 0.3 });
    this._tone({ f0: 70, f1: 22, dur: 0.7, gain: 1.0, rev: 0.8 });
  }

  grenadeThrow() {
    if (!this.ready) return;
    this._burst({ dur: 0.12, gain: 0.18, hp: 400, lp: 3000, rev: 0.1 });
    this._tone({ when: 0.05, f0: 800, f1: 500, dur: 0.04, gain: 0.08, type: 'square', rev: 0.1 });
  }

  ice() {
    if (!this.ready) return;
    this._burst({ dur: 0.35, gain: 0.35, hp: 3000, lp: 12000, rev: 0.6 });
    this._tone({ f0: 1900, f1: 900, dur: 0.25, gain: 0.12, type: 'triangle', rev: 0.5 });
  }

  heal() {
    if (!this.ready) return;
    this._tone({ f0: 440, f1: 660, dur: 0.12, gain: 0.12, type: 'triangle', rev: 0.2 });
    this._tone({ when: 0.12, f0: 660, f1: 880, dur: 0.16, gain: 0.12, type: 'triangle', rev: 0.2 });
  }

  hurt() {
    if (!this.ready) return;
    this._burst({ dur: 0.08, gain: 0.3, hp: 200, lp: 1200, rev: 0.1 });
    this._tone({ f0: 160, f1: 90, dur: 0.1, gain: 0.25, rev: 0.1 });
  }

  dry() {
    if (!this.ready) return;
    this._burst({ dur: 0.025, gain: 0.35, hp: 2500, lp: 9000, rev: 0.05 });
    this._tone({ f0: 900, f1: 600, dur: 0.02, gain: 0.08, type: 'square', rev: 0 });
  }

  /** Recarga sincronizada com a animacao (duracao total em segundos). */
  reload(id, dur) {
    if (!this.ready) return;
    const magOut = dur * 0.2;
    const magIn = dur * 0.8;
    const rack = dur * 0.88;
    // carregador sai
    this._burst({ when: magOut, dur: 0.05, gain: 0.3, hp: 1500, lp: 7000, rev: 0.15 });
    this._burst({ when: magOut + 0.06, dur: 0.12, gain: 0.14, bp: 900, q: 0.8, rev: 0.1 });
    this._tone({ when: magOut + 0.18, f0: 220, f1: 110, dur: 0.07, gain: 0.18, rev: 0.2 }); // cai no chao
    // carregador entra
    this._burst({ when: magIn, dur: 0.06, gain: 0.34, bp: 1400, q: 1.2, rev: 0.15 });
    this._tone({ when: magIn + 0.01, f0: 380, f1: 180, dur: 0.06, gain: 0.25, rev: 0.15 });
    // ferrolho / punho de armar
    const f = id === 'usp' ? 1.0 : 0.75;
    this._burst({ when: rack, dur: 0.05, gain: 0.34, hp: 2200 * f, lp: 10000, rev: 0.2 });
    this._burst({ when: rack + 0.12, dur: 0.05, gain: 0.38, hp: 1800 * f, lp: 9000, rev: 0.2 });
    this._tone({ when: rack + 0.12, f0: 700 * f, f1: 300, dur: 0.05, gain: 0.12, type: 'triangle', rev: 0.1 });
  }

  draw() {
    if (!this.ready) return;
    this._burst({ dur: 0.07, gain: 0.25, hp: 1200, lp: 8000, rev: 0.15 });
    this._tone({ f0: 500, f1: 260, dur: 0.05, gain: 0.1, type: 'triangle', rev: 0.1 });
  }

  impact(kind) {
    if (!this.ready) return;
    if (kind === 'plate') {
      const f = 1250 + Math.random() * 500;
      this._tone({ f0: f, f1: f * 0.98, dur: 0.5, gain: 0.3, rev: 0.5 });
      this._tone({ f0: f * 2.43, f1: f * 2.4, dur: 0.3, gain: 0.14, rev: 0.4 });
      this._burst({ dur: 0.025, gain: 0.35, hp: 3000, rev: 0.2 });
    } else if (kind === 'paper') {
      this._burst({ dur: 0.07, gain: 0.3, lp: 700, rev: 0.1 });
      this._burst({ dur: 0.02, gain: 0.2, hp: 2500, rev: 0.05 });
    } else {
      this._burst({ dur: 0.08, gain: 0.3, bp: 800, q: 0.6, rev: 0.25 });
      this._burst({ dur: 0.02, gain: 0.25, hp: 2500, rev: 0.1 });
    }
  }

  step(running) {
    if (!this.ready) return;
    this._burst({ dur: running ? 0.07 : 0.06, gain: running ? 0.2 : 0.12, lp: 420 + Math.random() * 120, hp: 70, rev: 0.12 });
    this._burst({ dur: 0.015, gain: running ? 0.06 : 0.035, hp: 2800, rev: 0.05 });
  }

  jump() {
    if (!this.ready) return;
    this._burst({ dur: 0.07, gain: 0.16, lp: 900, hp: 120, rev: 0.12 });
  }

  pickup() {
    if (!this.ready) return;
    this._tone({ f0: 520, f1: 520, dur: 0.07, gain: 0.14, type: 'triangle', rev: 0.15 });
    this._tone({ when: 0.07, f0: 780, f1: 780, dur: 0.09, gain: 0.14, type: 'triangle', rev: 0.15 });
    this._burst({ when: 0.02, dur: 0.05, gain: 0.2, hp: 2500, lp: 9000, rev: 0.1 });
  }

  restart() {
    if (!this.ready) return;
    this._tone({ f0: 520, f1: 780, dur: 0.12, gain: 0.12, type: 'triangle', rev: 0.2 });
  }
}
