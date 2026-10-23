const HELP_FADE_AFTER = 20;

/**
 * Heads-up display. Every DOM write is guarded by a value cache, so calling
 * update() each frame only touches the DOM when something changed.
 */
export class Hud {
  constructor(doc) {
    const $ = (id) => doc.getElementById(id);
    this.el = {
      root: $('hud'),
      score: $('score-val'),
      enemies: $('enemies-val'),
      combo: $('combo'),
      comboFill: $('combo-fill'),
      hpVal: $('hp-val'),
      hpFill: $('hp-fill'),
      lowhp: $('lowhp-overlay'),
      dashFill: $('dash-fill'),
      dashBar: $('dash-bar'),
      dashState: $('dash-state'),
      timeState: $('time-state'),
      timeVal: $('time-val'),
      timeFill: $('time-fill'),
      wave: $('wave-label'),
      controls: $('hud-controls'),
      cross: {
        t: doc.querySelector('#crosshair .ch.t'),
        b: doc.querySelector('#crosshair .ch.b'),
        l: doc.querySelector('#crosshair .ch.l'),
        r: doc.querySelector('#crosshair .ch.r'),
      },
    };
    this.reset();
  }

  reset() {
    this.cache = {};
    this.helpT = 0;
    this.el.controls.classList.remove('faded');
  }

  setVisible(v) {
    this.el.root.classList.toggle('hidden', !v);
  }

  toggleHelp() {
    this.el.controls.classList.toggle('faded');
  }

  _set(key, val, fn) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    fn(val);
  }

  /**
   * @param v {score, enemies, wave, hp, maxHp, dashPct, timeScale, frozen, combo, comboFrac, crosshairGap}
   */
  update(dt, v) {
    const e = this.el;
    if (this.helpT < HELP_FADE_AFTER && (this.helpT += dt) >= HELP_FADE_AFTER) e.controls.classList.add('faded');

    this._set('score', v.score, (x) => (e.score.textContent = x.toLocaleString('en-US')));
    this._set('enemies', v.enemies, (x) => (e.enemies.textContent = x));
    this._set('wave', v.wave, (x) => (e.wave.textContent = `WAVE ${x}`));
    this._set('hp', Math.ceil(v.hp), (x) => {
      e.hpVal.textContent = x;
      e.hpFill.style.transform = `scaleX(${x / v.maxHp})`;
      e.lowhp.style.opacity = x < 35 ? String(1 - x / 35) : '0';
    });
    this._set('dash', Math.round(v.dashPct), (x) => {
      e.dashFill.style.transform = `scaleX(${x / 100})`;
      e.dashBar.classList.toggle('ready', x >= 100);
      e.dashState.textContent = x >= 100 ? 'جاهز' : 'بيشحن…';
    });
    this._set('time', Math.round(v.timeScale * 100), (x) => {
      e.timeVal.textContent = `${x}%`;
      e.timeFill.style.transform = `scaleX(${x / 100})`;
    });
    this._set('frozen', v.frozen, (frozen) => {
      e.timeState.textContent = frozen ? 'الزمن متجمد ⏸' : 'الزمن بيتحرك ⚡';
      e.timeState.style.color = frozen ? 'var(--cyan)' : 'var(--pink)';
    });
    this._set('combo', v.combo, (x) => {
      e.combo.classList.toggle('on', x > 1);
      if (x > 1) e.combo.textContent = `COMBO x${x}`;
    });
    e.comboFill.style.width = `${v.comboFrac * 100}%`;
    this._set('gap', Math.round(v.crosshairGap), (g) => {
      const c = e.cross;
      c.t.style.top = `${-g - 9}px`;
      c.b.style.top = `${g}px`;
      c.l.style.left = `${-g - 9}px`;
      c.r.style.left = `${g}px`;
    });
  }
}
