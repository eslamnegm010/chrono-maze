import { CellType } from '../world/CellType.js';

const SIZE = 150;
const RADIUS = 72;
const RANGE_M = 48;
const RANGE_CELLS = 5;

/** Player-up rotating sonar: walls, barrels, enemy bullets, enemies (red = hunting) and teammates. */
export class Radar {
  constructor(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    this.ctx = canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);
    this.box = {};
    this.acc = 0;
  }

  /** Throttled to ~30 Hz. snapshot: { grid, player, barrels, enemies, bullets, allies?, time } */
  update(dt, snapshot) {
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    this.draw(snapshot);
  }

  draw({ grid, player: p, barrels, enemies, bullets, allies = [], time }) {
    const ctx = this.ctx;
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const scale = RADIUS / RANGE_M;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(3,6,16,0.95)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.yaw); // maps the player's forward vector to "up"
    const pc = grid.toCol(p.pos.x);
    const pr = grid.toRow(p.pos.z);
    for (let r = pr - RANGE_CELLS; r <= pr + RANGE_CELLS; r++) {
      for (let c = pc - RANGE_CELLS; c <= pc + RANGE_CELLS; c++) {
        if (!grid.inBounds(c, r) || !grid.isSolid(c, r)) continue;
        const b = grid.cellBox(c, r, this.box);
        ctx.fillStyle = grid.type(c, r) === CellType.PILLAR ? 'rgba(155,48,255,0.55)' : 'rgba(40,52,96,0.85)';
        ctx.fillRect((b.minX - p.pos.x) * scale, (b.minZ - p.pos.z) * scale, (b.maxX - b.minX) * scale, (b.maxZ - b.minZ) * scale);
      }
    }
    ctx.fillStyle = '#ffe600';
    for (const b of barrels) {
      if (!b.alive) continue;
      ctx.beginPath();
      ctx.arc((b.pos.x - p.pos.x) * scale, (b.pos.z - p.pos.z) * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff6688';
    for (const b of bullets) ctx.fillRect((b.pos.x - p.pos.x) * scale - 1, (b.pos.z - p.pos.z) * scale - 1, 2, 2);
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = (e.pos.x - p.pos.x) * scale;
      const ez = (e.pos.z - p.pos.z) * scale;
      ctx.fillStyle = e.isHunting ? '#ff0055' : '#00f3ff';
      ctx.beginPath();
      ctx.arc(ex, ez, e.scale > 1 ? 4.5 : 3.2, 0, Math.PI * 2);
      ctx.fill();
      if (e.isHunting) {
        ctx.strokeStyle = 'rgba(255,0,85,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ex, ez, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const a of allies) {
      if (!a.seen) continue;
      ctx.fillStyle = a.color.css;
      ctx.globalAlpha = a.down ? 0.45 + 0.4 * Math.sin(time * 8) : 1;
      ctx.fillRect((a.pos.x - p.pos.x) * scale - 3.5, (a.pos.z - p.pos.z) * scale - 3.5, 7, 7);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (ctx.createConicGradient) {
      const gr = ctx.createConicGradient((time * 2) % (Math.PI * 2), cx, cy);
      gr.addColorStop(0, 'rgba(0,243,255,0.22)');
      gr.addColorStop(0.12, 'rgba(0,243,255,0)');
      gr.addColorStop(1, 'rgba(0,243,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
    ctx.strokeStyle = 'rgba(0,243,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,243,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 4.5, cy + 4.5);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx - 4.5, cy + 4.5);
    ctx.closePath();
    ctx.fill();
  }
}
