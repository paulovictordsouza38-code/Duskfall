// Cliente das salas por codigo (WebSocket). Passos 1 e 2: criar sala, entrar com codigo, ver quem esta na sala.
export class Net {
  constructor() {
    this.ws = null;
    this.id = null;
    this.code = null;
    this.host = false;
    this.players = [];
    this.on = {};            // callbacks: status(texto), room(estado), error(msg), start(), relay(m)
    this._ping = null;
  }
  _emit(k, v) { if (this.on[k]) this.on[k](v); }

  connect(url) {
    return new Promise((resolve, reject) => {
      this.close();
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Endereco do servidor invalido')); return; }
      this.ws = ws;
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch (e) { /* ok */ } reject(new Error('Servidor nao respondeu (pode estar acordando, tente de novo em 30 s)')); } }, 25000);
      ws.onopen = () => { /* espera o "hello" */ };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('Nao consegui conectar no servidor')); } };
      ws.onclose = () => {
        clearInterval(this._ping);
        if (this.ws === ws) { this.ws = null; this.code = null; this.players = []; this._emit('status', 'Desconectado'); this._emit('room', this.state()); }
        if (!done) { done = true; clearTimeout(timer); reject(new Error('Conexao fechada')); }
      };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m.t === 'hello' && !done) {
          done = true; clearTimeout(timer);
          this._ping = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 25000);
          this._emit('status', 'Conectado');
          resolve(m);
        }
        this._onMsg(m);
      };
    });
  }
  state() { return { connected: !!this.ws, code: this.code, host: this.host, players: this.players, id: this.id }; }
  _onMsg(m) {
    if (m.t === 'joined') { this.id = m.id; this.code = m.code; this.host = !!m.host; this.players = m.players || []; this._emit('room', this.state()); }
    else if (m.t === 'players') { this.players = m.players || []; this.host = this.players.some((p) => p.id === this.id && p.host); this._emit('room', this.state()); }
    else if (m.t === 'left' && m.self) { this.code = null; this.players = []; this.host = false; this._emit('room', this.state()); }
    else if (m.t === 'error') this._emit('error', m.msg);
    else if (m.t === 'start') this._emit('start', m);
    else if (m.t === 'relay') this._emit('relay', m);
    else if (m.t !== 'hello' && m.t !== 'pong') this._emit('msg', m);
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  create(name, mode = 'duo') { this.send({ t: 'create', name, mode }); }
  join(code, name) { this.send({ t: 'join', code, name }); }
  leave() { this.send({ t: 'leave' }); }
  start() { this.send({ t: 'start' }); }
  close() { clearInterval(this._ping); if (this.ws) { try { this.ws.close(); } catch (e) { /* ok */ } } this.ws = null; this.code = null; this.players = []; }
}
