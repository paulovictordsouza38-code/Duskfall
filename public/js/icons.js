// Icones pequenos das armas e itens: desenhados a partir dos PROPRIOS modelos 3D do jogo (uma vez cada, guardados em cache).
import * as THREE from 'three';

const W = 144, H = 100;

export function createIcons(renderer, makeVisual) {
  const cache = new Map();
  let ctx = null;

  function init() {
    if (ctx) return ctx;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dl = new THREE.DirectionalLight(0xffffff, 2.4); dl.position.set(2, 4, 3); scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xbfd4ff, 1.0); dl2.position.set(-3, 1, -2); scene.add(dl2);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    ctx = { rt, scene, cam, cv, g: cv.getContext('2d'), buf: new Uint8Array(W * H * 4) };
    return ctx;
  }

  /** caixa do que e visivel (ignora sprites e partes escondidas, ex.: clarao do cano) */
  function bounds(obj) {
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh || o.isSprite) return;
      for (let p = o; p; p = p.parent) if (p.visible === false) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    });
    return box;
  }

  function render(type, id, white) {
    const c = init();
    const vis = makeVisual(type, id);
    const obj = vis.body;
    obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0);
    if (white) { const wm = new THREE.MeshBasicMaterial({ color: 0xffffff }); obj.traverse((o) => { if (o.isMesh) o.material = wm; }); }
    c.scene.add(obj);
    const box = bounds(obj);
    const size = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    // olha de lado: o eixo horizontal mais comprido fica na horizontal da imagem
    const alongX = size.x >= size.z;
    const dir = alongX ? new THREE.Vector3(0.18, 0.42, 1) : new THREE.Vector3(1, 0.42, -0.18);
    dir.normalize();
    c.cam.position.copy(ctr).addScaledVector(dir, 10);
    c.cam.up.set(0, 1, 0);
    c.cam.lookAt(ctr);
    c.cam.updateMatrixWorld(true);
    const inv = c.cam.matrixWorldInverse;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    let w = (x1 - x0) * 1.18 + 0.02, h = (y1 - y0) * 1.18 + 0.02;
    const asp = W / H;
    if (w / h < asp) w = h * asp; else h = w / asp;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    c.cam.left = cx - w / 2; c.cam.right = cx + w / 2; c.cam.top = cy + h / 2; c.cam.bottom = cy - h / 2;
    c.cam.updateProjectionMatrix();

    const prevRT = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(new THREE.Color());
    renderer.setRenderTarget(c.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(c.scene, c.cam);
    renderer.readRenderTargetPixels(c.rt, 0, 0, W, H, c.buf);
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevColor, prevAlpha);
    c.scene.remove(obj);

    const img = c.g.createImageData(W, H);
    for (let y = 0; y < H; y++) {                               // o buffer vem de cabeca para baixo
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let k = 0; k < W * 4; k++) img.data[dst + k] = c.buf[src + k];
    }
    c.g.putImageData(img, 0, 0);
    return c.cv.toDataURL('image/png');
  }

  function url(type, id, white = false) {
    const key = (white ? 'w:' : '') + type + ':' + id;
    if (cache.has(key)) return cache.get(key);
    let u = '';
    try { u = render(type, id, white) || ''; } catch (e) { u = ''; }
    cache.set(key, u);
    return u;
  }

  return {
    url,
    /** desenha 1 icone ainda nao pronto por chamada (evita travada ao chegar perto de um item) */
    warm(list) {
      for (const [t, i, w] of list) if (!cache.has((w ? 'w:' : '') + t + ':' + i)) { url(t, i, !!w); return true; }
      return false;
    },
  };
}
