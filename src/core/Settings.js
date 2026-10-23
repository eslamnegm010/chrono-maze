const SETTINGS_KEY = 'chronomaze_settings';
const BEST_KEY = 'chronomaze_best';

const DEFAULTS = Object.freeze({ sens: 1, vol: 0.7, bloom: true, name: '', color: 'cyan' });

/** localStorage can be missing or throw (private mode, sandboxed iframes) — fall back to memory. */
function safeStorage() {
  try {
    const s = window.localStorage;
    const probe = '__chronomaze_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }
}

export class Settings {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.values = { ...DEFAULTS };
    this.best = 0;
    try {
      Object.assign(this.values, JSON.parse(storage.getItem(SETTINGS_KEY) || '{}'));
      this.best = parseInt(storage.getItem(BEST_KEY) || '0', 10) || 0;
    } catch {
      // Corrupt saved data: keep defaults.
    }
  }

  set(key, value) {
    this.values[key] = value;
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.values));
    } catch {
      // Storage full or blocked: setting still applies for this session.
    }
  }

  /** Records a score; returns true when it is a new best. */
  submitScore(score) {
    if (score <= this.best) return false;
    this.best = score;
    try {
      this.storage.setItem(BEST_KEY, String(score));
    } catch {
      // Ignore: best score just won't persist.
    }
    return true;
  }
}
