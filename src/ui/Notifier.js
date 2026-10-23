/** Transient on-screen feedback: announcer, kill feed, toast, hit marker, damage flash & direction. */
export class Notifier {
  constructor(doc) {
    this.el = {
      announcer: doc.getElementById('announcer'),
      feed: doc.getElementById('killfeed'),
      toast: doc.getElementById('toast'),
      hitmarker: doc.getElementById('hitmarker'),
      damage: doc.getElementById('damage-overlay'),
      indicators: doc.getElementById('dmg-indicators'),
    };
    this.doc = doc;
    this._timers = {};
  }

  _later(key, ms, fn) {
    clearTimeout(this._timers[key]);
    this._timers[key] = setTimeout(fn, ms);
  }

  /** Big centred text. color: '' (pink) | 'cyan' | 'yellow' */
  announce(text, color = '', ms = 700) {
    const el = this.el.announcer;
    el.textContent = text;
    el.className = `show ${color}`;
    this._later('announce', ms, () => {
      el.className = color;
    });
  }

  toast(text, ms = 3200) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.add('show');
    this._later('toast', ms, () => el.classList.remove('show'));
  }

  feed(text, color = '') {
    const el = this.doc.createElement('div');
    el.className = `kf ${color}`;
    el.textContent = text;
    el.addEventListener('animationend', (ev) => {
      if (ev.animationName === 'kfout') el.remove();
    });
    const feed = this.el.feed;
    feed.prepend(el);
    while (feed.children.length > 5) feed.lastChild.remove();
  }

  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.classList.toggle('kill', kill);
    h.classList.add('show');
    this._later('hit', kill ? 180 : 90, () => h.classList.remove('show'));
  }

  /** Red screen flash + an arc pointing toward the attacker (angle in radians, 0 = ahead). */
  damage(angle) {
    const d = this.el.damage;
    d.classList.add('flash');
    this._later('damage', 90, () => d.classList.remove('flash'));
    const arc = this.doc.createElement('div');
    arc.className = 'dmg-arc';
    arc.style.transform = `rotate(${angle}rad)`;
    arc.addEventListener('animationend', () => arc.remove());
    this.el.indicators.appendChild(arc);
  }

  clear() {
    this.el.feed.replaceChildren();
    this.el.indicators.replaceChildren();
  }
}
