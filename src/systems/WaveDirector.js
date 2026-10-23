import { TUNE } from '../config/tuning.js';

/** Paces the run: start wave → wait until cleared → bonus → short break → next wave. */
export class WaveDirector {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.wave = 0;
    this.timer = -1;
    this.active = false;
  }

  /** Schedules wave 1 the first time play begins. */
  armFirstWave(delay = 1) {
    if (this.wave === 0 && this.timer < 0) this.timer = delay;
  }

  start(n) {
    const g = this.game;
    this.wave = n;
    this.active = true;
    g.barrels.restore();
    g.enemies.spawnWave(n);
    g.ui.announce(`WAVE ${n}`, 'yellow', 1300);
    g.audio.wave();
    g.net?.broadcastEvent({ t: 'wave', n });
  }

  update(dt) {
    const g = this.game;
    if (this.active && g.enemies.aliveCount === 0) {
      this.active = false;
      g.scoring.add(TUNE.waveClearBonus * this.wave, `WAVE ${this.wave} CLEAR`, 'yellow');
      g.ui.announce('WAVE CLEARED ✔', 'cyan', 1300);
      g.onWaveCleared();
      this.timer = 3;
    }
    if (!this.active && this.timer >= 0) {
      this.timer -= dt;
      if (this.timer < 0) this.start(this.wave + 1);
    }
  }
}
