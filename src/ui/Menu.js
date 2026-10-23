/**
 * Full-screen overlay for the main menu, pause screen and game-over screen,
 * plus the settings controls shared by menu & pause.
 */
export class Menu {
  /**
   * @param {Document} doc
   * @param {import('../core/Settings.js').Settings} settings
   * @param {{onMain: Function, onRestart: Function, onSetting: (key: string, value: any) => void}} handlers
   */
  constructor(doc, settings, handlers) {
    const $ = (id) => doc.getElementById(id);
    this.el = {
      overlay: $('overlay'),
      main: $('btn-main'),
      restart: $('btn-restart'),
      sens: $('sens'),
      sensVal: $('sens-val'),
      vol: $('vol'),
      volVal: $('vol-val'),
      bloom: $('bloom'),
      best: $('best-val'),
      overTitle: $('over-title'),
      stScore: $('st-score'),
      stWave: $('st-wave'),
      stKills: $('st-kills'),
      stHeads: $('st-heads'),
      error: $('load-error'),
    };
    this.mode = null;
    this._bindSettings(settings.values, handlers.onSetting);
    this.el.main.addEventListener('click', () => handlers.onMain(this.mode));
    this.el.restart.addEventListener('click', () => handlers.onRestart());
    this.setBest(settings.best);
  }

  _bindSettings(values, onSetting) {
    const e = this.el;
    const showSens = (v) => (e.sensVal.textContent = (+v).toFixed(2));
    const showVol = (v) => (e.volVal.textContent = `${Math.round(v * 100)}%`);
    e.sens.value = values.sens;
    showSens(values.sens);
    e.vol.value = values.vol;
    showVol(values.vol);
    e.bloom.checked = !!values.bloom;
    e.sens.addEventListener('input', () => {
      showSens(e.sens.value);
      onSetting('sens', +e.sens.value);
    });
    e.vol.addEventListener('input', () => {
      showVol(e.vol.value);
      onSetting('vol', +e.vol.value);
    });
    e.bloom.addEventListener('change', () => onSetting('bloom', e.bloom.checked));
  }

  /** mode: 'menu' | 'pause' | 'over' | null (hidden) */
  show(mode) {
    this.mode = mode;
    const o = this.el.overlay;
    if (!mode) {
      o.classList.add('hidden');
      return;
    }
    o.dataset.mode = mode;
    o.classList.remove('hidden');
  }

  clickMain() {
    if (this.mode) this.el.main.click();
  }

  disableBloom() {
    this.el.bloom.checked = false;
    this.el.bloom.disabled = true;
  }

  setBest(best) {
    this.el.best.textContent = best.toLocaleString('en-US');
  }

  showStats({ score, wave, kills, headshots, newBest }) {
    const e = this.el;
    e.overTitle.textContent = newBest ? '🏆 رقم قياسي جديد!' : '💀 تم تدميرك';
    e.stScore.textContent = score.toLocaleString('en-US');
    e.stWave.textContent = wave;
    e.stKills.textContent = kills;
    e.stHeads.textContent = headshots;
  }

  showFatal(message) {
    this.show('menu');
    this.el.error.textContent = message;
    this.el.error.style.display = 'block';
    this.el.main.disabled = true;
  }
}
