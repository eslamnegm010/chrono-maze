import { PLAYER_COLORS, normalizeRoomCode, randomName } from '../config/players.js';

/**
 * Full-screen overlay for the main menu, online lobby screens, pause and
 * game-over, plus the settings and identity controls.
 *
 * Elements declare where they appear with `data-show="menu pause …"`;
 * `data-mp` additionally limits them to multiplayer sessions.
 */
export class Menu {
  /**
   * @param {Document} doc
   * @param {import('../core/Settings.js').Settings} settings
   * @param {{name: string, color: {key: string}}} identity
   * @param {{onSolo, onHost, onJoin, onMain, onRestart, onLeave, onCopyInvite, onSetting, onIdentity}} handlers
   */
  constructor(doc, settings, identity, handlers) {
    const $ = (id) => doc.getElementById(id);
    this.doc = doc;
    this.el = {
      overlay: $('overlay'),
      main: $('btn-main'),
      restart: $('btn-restart'),
      leave: $('btn-leave'),
      host: $('btn-host'),
      join: $('btn-join'),
      invite: $('btn-invite'),
      randName: $('btn-randname'),
      name: $('player-name'),
      code: $('room-code'),
      swatches: $('swatches'),
      waiting: $('over-waiting'),
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
    this.sections = [...doc.querySelectorAll('#overlay [data-show]')];
    this.mode = null;
    this.handlers = handlers;
    this._bindSettings(settings.values, handlers.onSetting);
    this._bindIdentity(identity, handlers.onIdentity);

    const e = this.el;
    e.main.addEventListener('click', () => (this.mode === 'menu' ? handlers.onSolo() : handlers.onMain(this.mode)));
    e.restart.addEventListener('click', () => handlers.onRestart());
    e.leave.addEventListener('click', () => handlers.onLeave());
    e.host.addEventListener('click', () => handlers.onHost());
    e.join.addEventListener('click', () => handlers.onJoin(e.code.value));
    e.invite.addEventListener('click', () => handlers.onCopyInvite());
    e.code.addEventListener('input', () => (e.code.value = normalizeRoomCode(e.code.value)));
    for (const input of [e.name, e.code]) {
      // Typing must not trigger game shortcuts (Enter/P/H…).
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && input === e.code) handlers.onJoin(e.code.value);
      });
    }
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

  _bindIdentity(identity, onIdentity) {
    const e = this.el;
    this.colorKey = identity.color.key;
    e.name.value = identity.name;
    this.swatchEls = PLAYER_COLORS.map((c) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', c.css);
      b.textContent = c.sigil;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.key);
      b.addEventListener('click', () => {
        this.colorKey = c.key;
        this._paintSwatches();
        commit();
      });
      e.swatches.appendChild(b);
      return b;
    });
    const commit = () => onIdentity(e.name.value, this.colorKey);
    e.name.addEventListener('change', commit);
    e.randName.addEventListener('click', () => {
      e.name.value = randomName();
      commit();
    });
    this._paintSwatches();
  }

  _paintSwatches() {
    PLAYER_COLORS.forEach((c, i) => {
      const on = c.key === this.colorKey;
      this.swatchEls[i].classList.toggle('on', on);
      this.swatchEls[i].setAttribute('aria-checked', String(on));
    });
  }

  /** Reflects an identity the host assigned (unique name / free colour). */
  setIdentity(name, colorKey) {
    this.el.name.value = name;
    this.colorKey = colorKey;
    this._paintSwatches();
  }

  /**
   * mode: 'menu' | 'connecting' | 'ready' | 'pause' | 'over' | null (hidden)
   * opts: { inviteCode, code, multiplayer, canRestart, hostLost }
   */
  show(mode, opts = {}) {
    this.mode = mode;
    const o = this.el.overlay;
    if (!mode) {
      o.classList.add('hidden');
      return;
    }
    const mp = opts.multiplayer ?? (mode === 'connecting' || mode === 'ready');
    for (const s of this.sections) {
      s.hidden = !s.dataset.show.split(' ').includes(mode) || (s.dataset.mp === '1' && !mp);
    }
    if (mode === 'over') {
      const canRestart = opts.canRestart ?? true;
      this.el.main.hidden = !canRestart;
      this.el.waiting.hidden = canRestart || !!opts.hostLost;
    }
    if (mode === 'pause') this.el.restart.hidden = opts.canRestart === false;
    if (opts.code) for (const el of this.doc.querySelectorAll('#overlay .room-code')) el.textContent = opts.code;
    if (opts.inviteCode) {
      this.el.code.value = opts.inviteCode;
      this.el.join.classList.add('pulse');
    }
    o.dataset.mode = mode;
    o.classList.remove('hidden');
  }

  clickMain() {
    if (this.mode && !this.el.main.hidden) this.el.main.click();
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
