import { clamp } from '../core/math.js';

/**
 * Keyboard, mouse and pointer-lock handling. Translates raw DOM events into
 * game intents via `handlers`; holds no game logic itself.
 *
 * Falls back to "drag look" (hold a mouse button and drag) where pointer
 * lock is unavailable, e.g. inside some embedded previews.
 */
export class Input {
  /**
   * @param {HTMLElement} canvas
   * @param {object} handlers  isActive(), onLook(dx,dy), onFire(), onThrow(), onDash(), onJump(),
   *                           onPause(), onToggleHelp(), onConfirm(), onFocusLost(),
   *                           onNeedLock(), onLockChange(locked), onLockError()
   */
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.keys = {};
    this.mouseDown = false;
    this.locked = false;
    this.lockEverWorked = false;
    this.dragLook = !canvas.requestPointerLock;
    this._bind();
  }

  clear() {
    this.keys = {};
    this.mouseDown = false;
  }

  requestLock() {
    if (this.dragLook) return false;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // the pointerlockerror event reports failures
    } catch {
      this.h.onLockError();
    }
    return true;
  }

  exitLock() {
    if (this.locked) document.exitPointerLock();
  }

  _bind() {
    const h = this.h;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.lockEverWorked = true;
      h.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => h.onLockError());

    window.addEventListener('mousemove', (e) => {
      if (!h.isActive()) return;
      if (!this.locked && !(this.dragLook && e.buttons)) return;
      // Clamp: some browsers report huge spikes on the first locked event.
      h.onLook(clamp(e.movementX || 0, -200, 200), clamp(e.movementY || 0, -200, 200));
    });

    window.addEventListener('mousedown', (e) => {
      if (!h.isActive()) return;
      if (!this.locked && !this.dragLook) {
        h.onNeedLock();
        return;
      }
      if (e.button === 0) {
        this.mouseDown = true;
        h.onFire();
      } else if (e.button === 2) {
        h.onThrow();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!h.isActive()) {
        if (e.code === 'Enter') h.onConfirm();
        return;
      }
      this.keys[e.code] = true;
      if (e.repeat) return;
      switch (e.code) {
        case 'ShiftLeft':
        case 'ShiftRight':
          h.onDash();
          break;
        case 'Space':
          h.onJump();
          break;
        case 'KeyF':
          h.onThrow();
          break;
        case 'KeyH':
          h.onToggleHelp();
          break;
        case 'KeyP':
        case 'Escape':
          h.onPause();
          break;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Never leave keys "stuck" when focus leaves the page.
    window.addEventListener('blur', () => {
      this.clear();
      h.onFocusLost();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) h.onFocusLost();
    });
  }
}
