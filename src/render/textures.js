import * as THREE from 'three';

/** All textures are drawn procedurally on canvases — no image assets to ship. */
export function canvasTexture(renderer, w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

export function createTextures(renderer) {
  const tex = (w, h, draw) => canvasTexture(renderer, w, h, draw);

  const dot = tex(64, 64, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
  });

  const alert = tex(64, 64, (g) => {
    g.font = '900 52px Orbitron, Arial';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff0055';
    g.shadowBlur = 12;
    g.fillStyle = '#ff2a6a';
    g.fillText('!', 32, 34);
  });

  const flash = tex(64, 64, (g, w) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(120,250,255,0.9)');
    gr.addColorStop(1, 'rgba(0,243,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(200,255,255,0.8)';
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      g.beginPath();
      g.moveTo(32, 32);
      g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
      g.stroke();
    }
  });

  const floorMap = tex(256, 256, (g, w) => {
    g.fillStyle = '#0b0d19';
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(120,140,255,${Math.random() * 0.03})`;
      g.fillRect(Math.random() * w, Math.random() * w, 3, 3);
    }
    g.strokeStyle = '#1b2244';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, w - 4);
    g.strokeStyle = '#121734';
    g.lineWidth = 2;
    g.strokeRect(w * 0.25, w * 0.25, w * 0.5, w * 0.5);
  });

  const floorEmissive = tex(256, 256, (g, w) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(0,243,255,0.55)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, w - 2);
    g.fillStyle = 'rgba(255,0,85,0.8)';
    [
      [6, 6],
      [w - 10, 6],
      [6, w - 10],
      [w - 10, w - 10],
    ].forEach(([x, y]) => g.fillRect(x, y, 4, 4));
  });

  const wallMap = tex(512, 256, (g, w, h) => {
    g.fillStyle = '#151829';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = '#0a0c16';
    g.lineWidth = 5;
    for (let x = 0; x <= w; x += w / 4) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(0, h * 0.62);
    g.lineTo(w, h * 0.62);
    g.stroke();
    g.strokeStyle = 'rgba(130,150,255,0.09)';
    g.lineWidth = 2;
    for (let x = 0; x < w; x += w / 4) {
      g.strokeRect(x + 8, 8, w / 4 - 16, h * 0.62 - 16);
      g.strokeRect(x + 8, h * 0.62 + 8, w / 4 - 16, h * 0.38 - 16);
    }
    g.fillStyle = '#0c0e1b';
    for (let x = 0; x < w; x += w / 4) {
      for (let k = 0; k < 4; k++) g.fillRect(x + 24, h * 0.7 + k * 12, w / 4 - 48, 5);
    }
  });

  const wallEmissive = tex(512, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,243,255,0.55)';
    g.fillRect(0, h * 0.62 - 1.5, w, 3);
    g.fillStyle = 'rgba(255,0,85,0.9)';
    for (let x = 0; x < w; x += w / 4) g.fillRect(x + w / 8 - 10, h * 0.62 - 14, 20, 4);
  });

  return { dot, alert, flash, floorMap, floorEmissive, wallMap, wallEmissive };
}
