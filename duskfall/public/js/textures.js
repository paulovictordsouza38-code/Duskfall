// Texturas PROCEDURAIS (geradas em canvas): nao dependem de arquivos externos.
// Cada conjunto tem mapa de cor, rugosidade e normal, para materiais PBR.
import * as THREE from 'three';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ruido de valor que repete (tileable)
function noiseLayer(size, cells, rand) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  const out = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * k;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % cells) * cells;
    const yb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * k;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const a = g[ya + xa];
      const b = g[ya + xb];
      const c = g[yb + xa];
      const d = g[yb + xb];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function fbm(size, seed, baseCells = 4, octaves = 4, persistence = 0.5) {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let sum = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const c = Math.min(cells, size);
    const layer = noiseLayer(size, c, rand);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    sum += amp;
    amp *= persistence;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fillCanvas(size, fn) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      fn(x, y, y * size + x, out);
      const p = (y * size + x) * 4;
      d[p] = out[0] * 255;
      d[p + 1] = out[1] * 255;
      d[p + 2] = out[2] * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function normalFromHeight(h, size, strength) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const l = h[y * size + xm];
      const r = h[y * size + xp];
      const u = h[ym + x];
      const dn = h[yp + x];
      let nx = (l - r) * strength;
      let ny = (dn - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const p = (y * size + x) * 4;
      d[p] = (nx * 0.5 + 0.5) * 255;
      d[p + 1] = (ny * 0.5 + 0.5) * 255;
      d[p + 2] = (nz * 0.5 + 0.5) * 255;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function createTextureLib(renderer, { size = 512 } = {}) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const small = Math.max(128, size >> 1);

  function tex(canvas, srgb = false) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const memo = new Map();
  function once(key, make) {
    if (!memo.has(key)) memo.set(key, make());
    return memo.get(key);
  }

  function build(sizePx, heightFn, colorFn, roughFn, normalStrength) {
    const h = heightFn(sizePx);
    const map = fillCanvas(sizePx, (x, y, i, o) => colorFn(x, y, i, h, o));
    const rough = fillCanvas(sizePx, (x, y, i, o) => { const v = roughFn(x, y, i, h); o[0] = o[1] = o[2] = v; });
    const normal = normalFromHeight(h, sizePx, normalStrength);
    return { map: tex(map, true), roughnessMap: tex(rough), normalMap: tex(normal), _mapCanvas: map };
  }

  // ---------------- concreto (piso e paredes) ----------------
  function concrete() {
    return once('concrete', () => {
      const n = size;
      const base = fbm(n, 11, 5, 5, 0.55);
      const grain = fbm(n, 12, 64, 2, 0.5);
      const stain = fbm(n, 13, 3, 3, 0.6);
      const set = build(
        n,
        () => {
          const h = new Float32Array(n * n);
          for (let i = 0; i < h.length; i++) h[i] = base[i] * 0.6 + grain[i] * 0.4;
          return h;
        },
        (x, y, i, h, o) => {
          const dirt = Math.max(0, stain[i] - 0.55) * 0.38;
          const v = 0.42 + (base[i] - 0.5) * 0.24 + (grain[i] - 0.5) * 0.14 - dirt;
          o[0] = v * 1.02; o[1] = v; o[2] = v * 0.96;
        },
        (x, y, i) => 0.80 + (grain[i] - 0.5) * 0.28 + Math.max(0, stain[i] - 0.6) * 0.15,
        2.6,
      );
      // fissuras e marcas de uso desenhadas por cima da cor
      const ctx = set._mapCanvas.getContext('2d');
      const rand = mulberry32(77);
      ctx.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        let x = rand() * n;
        let y = rand() * n;
        ctx.strokeStyle = 'rgba(18,18,18,0.45)';
        ctx.lineWidth = 1 + rand();
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < 8; s++) {
          x += (rand() - 0.5) * 60;
          y += rand() * 40;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let k = 0; k < 14; k++) { // riscos de botas/rodas
        ctx.strokeStyle = 'rgba(10,10,10,0.10)';
        ctx.lineWidth = 3 + rand() * 6;
        ctx.beginPath();
        const x = rand() * n;
        const y = rand() * n;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + (rand() - 0.5) * 120, y + (rand() - 0.5) * 120, x + (rand() - 0.5) * 160, y + (rand() - 0.5) * 160);
        ctx.stroke();
      }
      set.map.needsUpdate = true;
      return set;
    });
  }

  // ---------------- chapa metalica pintada (paredes superiores) ----------------
  function metalPanel() {
    return once('metalPanel', () => {
      const n = size;
      const row = new Float32Array(n);
      const rand = mulberry32(21);
      for (let i = 0; i < n; i++) row[i] = rand();
      const soft = fbm(n, 22, 6, 3, 0.5);
      const half = n / 2;
      const seam = (x, y) => {
        const dx = Math.min(x % half, half - (x % half));
        const dy = Math.min(y % half, half - (y % half));
        return Math.min(dx, dy);
      };
      const rivet = (x, y) => {
        const px = x % half;
        const py = y % half;
        let best = 99;
        for (const cx of [14, half - 14]) for (const cy of [14, half - 14]) best = Math.min(best, Math.hypot(px - cx, py - cy));
        return best;
      };
      return build(
        n,
        () => {
          const h = new Float32Array(n * n);
          for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
              let v = 0.5 + (row[y] * 0.5 + row[(y + 1) % n] * 0.5) * 0.04 + soft[y * n + x] * 0.03;
              const s = seam(x, y);
              if (s < 3) v -= 0.35 * (1 - s / 3);
              const r = rivet(x, y);
              if (r < 5) v += 0.25 * (1 - r / 5);
              h[y * n + x] = v;
            }
          }
          return h;
        },
        (x, y, i, h, o) => {
          const brushed = (row[y] - 0.5) * 0.05 + (soft[i] - 0.5) * 0.08;
          let v = 0.30 + brushed;
          const s = seam(x, y);
          if (s < 3) v *= 0.6;
          // escorrido de sujeira sob os rebites
          const py = y % half;
          v -= Math.max(0, 0.05 - py * 0.0003) * (rivet(x, 14) < 8 ? 1 : 0);
          o[0] = v * 0.96; o[1] = v; o[2] = v * 1.05;
        },
        (x, y, i) => 0.42 + (row[y] - 0.5) * 0.16 + (soft[i] - 0.5) * 0.2,
        2.0,
      );
    });
  }

  // ---------------- tecido (uniforme) ----------------
  function fabric() {
    return once('fabric', () => {
      const n = small;
      const noise = fbm(n, 31, 32, 2, 0.5);
      return build(
        n,
        () => {
          const h = new Float32Array(n * n);
          for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
              const weave = ((x % 4 < 2) !== (y % 4 < 2)) ? 0.55 : 0.42;
              const rip = (x % 16 < 2 || y % 16 < 2) ? 0.2 : 0;
              h[y * n + x] = weave + rip + noise[y * n + x] * 0.08;
            }
          }
          return h;
        },
        (x, y, i, h, o) => {
          const v = 0.075 + (noise[i] - 0.5) * 0.03 + (h[i] - 0.5) * 0.03;
          o[0] = v * 0.95; o[1] = v; o[2] = v * 1.08;
        },
        () => 0.92,
        3.4,
      );
    });
  }

  // ---------------- colete: tira MOLLE ----------------
  function molle() {
    return once('molle', () => {
      const n = small;
      const noise = fbm(n, 41, 24, 2, 0.5);
      return build(
        n,
        () => {
          const h = new Float32Array(n * n);
          for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
              const cy = y % 32;
              let v = 0.35;
              if (cy < 9) {
                v = 0.85;
                if (x % 24 < 11) v = 0.30; // fenda entre as alcas
              } else if (cy < 12) v = 0.5;
              h[y * n + x] = v + noise[y * n + x] * 0.06;
            }
          }
          return h;
        },
        (x, y, i, h, o) => {
          const v = 0.085 + (h[i] - 0.4) * 0.035 + (noise[i] - 0.5) * 0.02;
          o[0] = v; o[1] = v * 1.02; o[2] = v * 1.06;
        },
        () => 0.88,
        4.2,
      );
    });
  }

  // ---------------- borracha ----------------
  function rubber() {
    return once('rubber', () => {
      const n = small;
      const noise = fbm(n, 51, 48, 2, 0.5);
      return build(
        n,
        () => noise,
        (x, y, i, h, o) => { const v = 0.05 + (noise[i] - 0.5) * 0.02; o[0] = o[1] = o[2] = v; },
        (x, y, i) => 0.85 + (noise[i] - 0.5) * 0.1,
        2.0,
      );
    });
  }

  // ---------------- caixa militar verde-oliva ----------------
  function crate() {
    return once('crate', () => {
      const n = size;
      const noise = fbm(n, 61, 8, 4, 0.5);
      const grain = fbm(n, 62, 64, 2, 0.5);
      const set = build(
        n,
        () => {
          const h = new Float32Array(n * n);
          for (let i = 0; i < h.length; i++) h[i] = noise[i] * 0.5 + grain[i] * 0.2;
          return h;
        },
        (x, y, i, h, o) => {
          const v = (noise[i] - 0.5) * 0.08 + (grain[i] - 0.5) * 0.05;
          o[0] = 0.21 + v; o[1] = 0.25 + v; o[2] = 0.14 + v * 0.7;
        },
        (x, y, i) => 0.58 + (grain[i] - 0.5) * 0.3,
        1.4,
      );
      const ctx = set._mapCanvas.getContext('2d');
      const rand = mulberry32(63);
      // tinta descascada
      for (let k = 0; k < 90; k++) {
        ctx.strokeStyle = `rgba(${130 + rand() * 40},${125 + rand() * 40},${115 + rand() * 30},${0.18 + rand() * 0.25})`;
        ctx.lineWidth = 1 + rand() * 1.5;
        const x = rand() * n;
        const y = rand() * n;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 40);
        ctx.stroke();
      }
      // estencil
      ctx.fillStyle = 'rgba(225,220,200,0.55)';
      ctx.font = `bold ${Math.round(n * 0.085)}px "Arial Narrow", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('TREINAMENTO', n * 0.5, n * 0.36);
      ctx.font = `bold ${Math.round(n * 0.06)}px "Arial Narrow", Arial, sans-serif`;
      ctx.fillText('LOTE 07-B  •  9x19', n * 0.5, n * 0.46);
      ctx.fillRect(n * 0.18, n * 0.52, n * 0.64, 3);
      set.map.needsUpdate = true;
      return set;
    });
  }

  // ---------------- listras de aviso amarelo/preto ----------------
  function stripes() {
    return once('stripes', () => {
      const c = makeCanvas(256, 64);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#d9b300';
      ctx.fillRect(0, 0, 256, 64);
      ctx.fillStyle = '#16140f';
      for (let x = -64; x < 320; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 64);
        ctx.lineTo(x + 32, 64);
        ctx.lineTo(x + 64, 0);
        ctx.lineTo(x + 32, 0);
        ctx.closePath();
        ctx.fill();
      }
      // desgaste
      const rand = mulberry32(5);
      for (let k = 0; k < 160; k++) {
        ctx.fillStyle = `rgba(60,55,45,${rand() * 0.25})`;
        ctx.fillRect(rand() * 256, rand() * 64, 1 + rand() * 6, 1 + rand() * 3);
      }
      const t = tex(c, true);
      return t;
    });
  }

  // ---------------- painel traseiro de contencao (borracha com listras) ----------------
  function backstop() {
    return once('backstop', () => {
      const n = small;
      const noise = fbm(n, 71, 16, 3, 0.5);
      const set = build(
        n,
        () => {
          const h = new Float32Array(n * n);
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = noise[y * n + x] * 0.4 + ((y % 32) < 3 ? 0.5 : 0);
          return h;
        },
        (x, y, i, h, o) => { const v = 0.06 + (noise[i] - 0.5) * 0.04; o[0] = v; o[1] = v * 0.98; o[2] = v * 0.95; },
        () => 0.9,
        3.0,
      );
      return set;
    });
  }

  // ---------------- cartolina da silhueta ----------------
  function silhouettePaper() {
    return once('silhouettePaper', () => {
      const w = 256;
      const h = 512;
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#b79a6a';
      ctx.fillRect(0, 0, w, h);
      const rand = mulberry32(81);
      for (let k = 0; k < 900; k++) {
        ctx.fillStyle = `rgba(${90 + rand() * 40},${70 + rand() * 40},40,${rand() * 0.07})`;
        ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 12, 1 + rand() * 2);
      }
      // aneis de pontuacao (mapeados: u=(x+0.30)/0.60, v=(y-0.30)/1.46)
      ctx.strokeStyle = 'rgba(30,24,16,0.65)';
      ctx.lineWidth = 3;
      const toX = (x) => ((x + 0.30) / 0.60) * w;
      const toY = (y) => (1 - (y - 0.30) / 1.46) * h;
      // cabeca
      ctx.beginPath();
      ctx.arc(toX(0), toY(1.60), (0.085 / 0.60) * w, 0, Math.PI * 2);
      ctx.stroke();
      // centro de massa
      ctx.strokeRect(toX(-0.18), toY(1.40), (0.36 / 0.60) * w, (0.60 / 1.46) * h);
      ctx.beginPath();
      ctx.ellipse(toX(0), toY(1.10), (0.12 / 0.60) * w, (0.20 / 1.46) * h, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(30,24,16,0.5)';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('50', toX(0.23), toY(0.65));
      ctx.fillText('75', toX(0), toY(1.12));
      const t = tex(c, true);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }

  // ---------------- placa de aco pintada ----------------
  function steelPlate() {
    return once('steelPlate', () => {
      const n = 256;
      const c = makeCanvas(n);
      const ctx = c.getContext('2d');
      const noise = fbm(n, 91, 8, 3, 0.5);
      const img = ctx.createImageData(n, n);
      for (let i = 0; i < n * n; i++) {
        const v = (noise[i] - 0.5) * 0.12;
        img.data[i * 4] = (0.72 + v) * 255;
        img.data[i * 4 + 1] = (0.15 + v * 0.4) * 255;
        img.data[i * 4 + 2] = (0.10 + v * 0.4) * 255;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      // anel central branco
      ctx.strokeStyle = 'rgba(235,230,220,0.9)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(n / 2, n / 2, n * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n / 2, n / 2, n * 0.175, 0, Math.PI * 2);
      ctx.stroke();
      const t = tex(c, true);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }

  // ---------------- textos (placas, marcacoes no piso) ----------------
  function textTexture(text, { w = 512, h = 128, fg = '#e8e4d8', bg = '#14171a', border = '#d9b300', font = 'bold 64px "Arial Narrow", Arial, sans-serif', transparent = false } = {}) {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!transparent) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
      if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = 6;
        ctx.strokeRect(5, 5, w - 10, h - 10);
      }
    }
    ctx.fillStyle = fg;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  }

  // marca de impacto (decal)
  function bulletHole() {
    return once('bulletHole', () => {
      const n = 64;
      const c = makeCanvas(n);
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(n / 2, n / 2, 1, n / 2, n / 2, n / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.95)');
      g.addColorStop(0.35, 'rgba(10,8,6,0.85)');
      g.addColorStop(0.7, 'rgba(30,26,20,0.35)');
      g.addColorStop(1, 'rgba(30,26,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, n, n);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  }

  function flashTexture() {
    return once('flash', () => {
      const n = 128;
      const c = makeCanvas(n);
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(n / 2, n / 2, 2, n / 2, n / 2, n / 2);
      g.addColorStop(0, 'rgba(255,250,225,1)');
      g.addColorStop(0.25, 'rgba(255,210,120,0.85)');
      g.addColorStop(0.6, 'rgba(255,140,40,0.25)');
      g.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, n, n);
      // raios
      ctx.translate(n / 2, n / 2);
      ctx.fillStyle = 'rgba(255,230,170,0.7)';
      for (let k = 0; k < 6; k++) {
        ctx.rotate((Math.PI * 2) / 6);
        ctx.beginPath();
        ctx.moveTo(0, -3);
        ctx.lineTo(n * 0.46, 0);
        ctx.lineTo(0, 3);
        ctx.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
  }

  return {
    concrete, metalPanel, fabric, molle, rubber, crate, stripes, backstop,
    silhouettePaper, steelPlate, textTexture, bulletHole, flashTexture,
  };
}

/** Material PBR a partir de um conjunto (map/roughnessMap/normalMap). */
export function pbr(set, opts = {}) {
  const { color = 0xffffff, metalness = 0, roughness = 1, normalScale = 1 } = opts;
  const m = new THREE.MeshStandardMaterial({
    color,
    map: set.map || null,
    roughnessMap: set.roughnessMap || null,
    normalMap: set.normalMap || null,
    metalness,
    roughness,
  });
  m.normalScale.set(normalScale, normalScale);
  return m;
}
