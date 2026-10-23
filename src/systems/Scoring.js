import { TUNE, KILL_BONUS } from '../config/tuning.js';

/** Score, kill stats and the timed combo multiplier. */
export class Scoring {
  /** @param ui {feed(text, color), announce(text, color, ms)} — broadcast to peers in multiplayer */
  constructor(ui) {
    this.ui = ui;
    this.reset();
  }

  reset() {
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.combo = 0;
    this.comboT = 0;
  }

  get comboActive() {
    return this.combo > 1 && this.comboT > 0;
  }

  get multiplier() {
    return Math.min(this.combo, TUNE.comboMax);
  }

  add(points, label, color) {
    this.score += points;
    this.ui.feed(`+${points}  ${label}`, color);
  }

  /**
   * @param type  ENEMY_TYPES entry
   * @param cause 'body' | 'head' | 'blast' | 'throw'
   * @param by    shooter name shown in the feed (multiplayer), or null
   */
  registerKill(type, cause, by = null) {
    this.kills++;
    if (cause === 'head') this.headshots++;
    this.combo = this.comboT > 0 ? this.combo + 1 : 1;
    this.comboT = TUNE.comboWindow;

    const bonus = KILL_BONUS[cause] ?? KILL_BONUS.body;
    const mult = this.multiplier;
    const label = (by ? `${by} · ` : '') + (bonus.label ?? type.label);
    this.add((type.score + bonus.bonus) * mult, mult > 1 ? `${label} x${mult}` : label, cause === 'head' ? 'yellow' : 'pink');

    const n = this.ui;
    if (this.combo === 2) n.announce('DOUBLE KILL', 'cyan', 700);
    else if (this.combo === 3) n.announce('TRIPLE KILL', 'cyan', 800);
    else if (this.combo >= 4) n.announce('CHRONO MASTER', 'yellow', 900);
    else if (cause === 'head') n.announce('HEADSHOT', 'yellow', 600);
  }

  tick(dt) {
    if (this.comboT > 0 && (this.comboT -= dt) <= 0) this.combo = 0;
  }
}
