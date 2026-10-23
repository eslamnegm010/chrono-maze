import * as THREE from 'three';
import './styles/main.css';
import { Game } from './core/Game.js';
import { DEFAULT_LEVEL } from './config/levels/index.js';
import { validateLevel } from './world/validateLevel.js';

// The game's colours were authored as raw (non-colour-managed) values.
THREE.ColorManagement.enabled = false;

function fatal(message) {
  const el = document.getElementById('load-error');
  el.textContent = message;
  el.style.display = 'block';
  document.getElementById('btn-main').disabled = true;
}

const problems = validateLevel(DEFAULT_LEVEL);
if (problems.length) {
  console.error(`Level "${DEFAULT_LEVEL.id}" is invalid:\n- ${problems.join('\n- ')}`);
  fatal('ملف المرحلة فيه مشكلة — شوف الـ console.');
} else {
  try {
    const game = new Game(document, DEFAULT_LEVEL);
    game.start();
    // Expose for debugging and automated smoke tests: add ?debug to the URL.
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) window.__game = game;
  } catch (e) {
    console.error(e);
    fatal('المتصفح ده مش بيدعم WebGL أو حصل خطأ في التشغيل — جرّب Chrome أو Edge.');
  }
}
