import { TUNE } from '../config/tuning.js';
import { clamp } from './math.js';
import { GameState } from './GameState.js';
import { Settings } from './Settings.js';
import { SoundEngine } from '../audio/SoundEngine.js';
import { RenderPipeline } from '../render/RenderPipeline.js';
import { createSharedAssets } from '../render/SharedAssets.js';
import { Grid } from '../world/Grid.js';
import { buildWorld } from '../world/WorldBuilder.js';
import { Barrels } from '../world/Barrels.js';
import { Effects } from '../fx/Effects.js';
import { Player } from '../entities/Player.js';
import { EnemyManager } from '../systems/EnemyManager.js';
import { EnemyProjectiles } from '../systems/EnemyProjectiles.js';
import { WaveDirector } from '../systems/WaveDirector.js';
import { Combat } from '../systems/Combat.js';
import { Scoring } from '../systems/Scoring.js';
import { TimeController } from '../systems/TimeController.js';
import { CameraRig } from '../systems/CameraRig.js';
import { Viewmodel } from '../weapon/Viewmodel.js';
import { Input } from '../input/Input.js';
import { Hud } from '../ui/Hud.js';
import { Radar } from '../ui/Radar.js';
import { Notifier } from '../ui/Notifier.js';
import { Menu } from '../ui/Menu.js';

/**
 * Composition root and state machine. Builds every subsystem, wires input to
 * intents, and runs the frame loop. Subsystems receive the Game as a shared
 * context (grid, player, time, audio, effects…) rather than importing each other.
 *
 * Frame order: player (real time) → time dilation → enemies → projectiles →
 * thrown weapon → barrels → FX → waves → camera → viewmodel → HUD → render.
 */
export class Game {
  constructor(doc, level) {
    this.doc = doc;
    this.level = level;
    this.state = GameState.MENU;
    this.realTime = 0;
    this.dieT = 0;

    this.settings = new Settings();
    this.audio = new SoundEngine();
    this.audio.volume = this.settings.values.vol;

    this.grid = new Grid(level);
    this.pipeline = new RenderPipeline(doc.getElementById('canvas-container'));
    this.scene = this.pipeline.scene;
    this.camera = this.pipeline.camera;
    this.assets = createSharedAssets(this.pipeline.renderer);
    this.world = buildWorld({ scene: this.scene, grid: this.grid, assets: this.assets });
    this.barrels = new Barrels(this.scene, this.grid);
    this.effects = new Effects(this.scene, this.assets, this.grid);
    this.viewmodel = new Viewmodel(this.pipeline.weaponScene, this.pipeline.weaponCam, this.camera, this.assets);
    this.projectiles = new EnemyProjectiles(this.scene, this.assets);

    this.notifier = new Notifier(doc);
    this.hud = new Hud(doc);
    this.radar = new Radar(doc.getElementById('radar-canvas'));

    this.player = new Player(this.grid, level.spawn);
    this.time = new TimeController();
    this.camRig = new CameraRig(this.camera);
    this.scoring = new Scoring(this.notifier);
    this.enemies = new EnemyManager(this);
    this.waves = new WaveDirector(this);
    this.combat = new Combat(this);

    this.menu = new Menu(doc, this.settings, {
      onMain: (mode) => {
        if (mode === 'over') this.resetRun();
        this.requestPlay();
      },
      onRestart: () => {
        this.resetRun();
        this.requestPlay();
      },
      onSetting: (key, value) => this.applySetting(key, value),
    });
    this.pipeline.setBloom(this.settings.values.bloom);
    if (!this.pipeline.composer) this.menu.disableBloom();

    this.input = new Input(this.pipeline.canvas, this._inputHandlers());

    this.resetRun();
    this.menu.show('menu');
    this.hud.setVisible(false);
    this._loop = (t) => this._frame(t);
  }

  start() {
    this.lastT = performance.now();
    requestAnimationFrame(this._loop);
  }

  /* ───────────── flow ───────────── */

  _inputHandlers() {
    const playing = () => this.state === GameState.PLAYING;
    return {
      isActive: playing,
      onLook: (dx, dy) => {
        this.player.look(dx, dy, TUNE.mouseSensitivity * this.settings.values.sens);
        this.viewmodel.addLook(dx, dy);
        this.time.addLook(Math.abs(dx) + Math.abs(dy));
      },
      onFire: () => this.combat.fire(),
      onThrow: () => this.combat.throwWeapon(),
      onDash: () => this.dash(),
      onJump: () => this.player.queueJump(),
      onToggleHelp: () => this.hud.toggleHelp(),
      onPause: () => (this.input.locked ? this.input.exitLock() : this.pause()),
      onConfirm: () => this.menu.clickMain(),
      onNeedLock: () => this.requestPlay(),
      onFocusLost: () => {
        if (!playing()) return;
        this.input.exitLock();
        this.pause();
      },
      onLockChange: (locked) => {
        if (locked && this.state !== GameState.PLAYING && this.state !== GameState.DYING) this.beginPlay();
        else if (!locked && playing() && !this.input.dragLook) this.pause();
      },
      onLockError: () => {
        if (this.input.lockEverWorked) {
          this.notifier.toast('استنى ثانية واضغط تاني (المتصفح بيمنع القفل بسرعة بعد Esc)');
          return;
        }
        // Pointer lock unsupported here: play with click-and-drag look instead.
        this.input.dragLook = true;
        this.beginPlay();
        this.notifier.toast('وضع السحب: اسحب بالماوس عشان تلف، أو استخدم الأسهم');
      },
    };
  }

  applySetting(key, value) {
    this.settings.set(key, value);
    if (key === 'vol') this.audio.setVolume(value);
    if (key === 'bloom') this.pipeline.setBloom(value);
  }

  /** Called from a user gesture: unlock audio, then grab the pointer (or start directly in drag mode). */
  requestPlay() {
    this.audio.init();
    this.audio.setVolume(this.settings.values.vol);
    if (!this.input.requestLock()) this.beginPlay();
  }

  beginPlay() {
    this.state = GameState.PLAYING;
    this.menu.show(null);
    this.hud.setVisible(true);
    this.input.clear();
    this.viewmodel.setVisible(this.combat.gunReady);
    this.lastT = performance.now();
    this.waves.armFirstWave(1);
  }

  pause() {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.PAUSED;
    this.input.clear();
    this.menu.show('pause');
  }

  resetRun() {
    this.enemies.clear();
    this.projectiles.clear();
    this.effects.clear();
    this.combat.reset();
    this.barrels.restore();
    this.player.reset();
    this.time.reset();
    this.camRig.reset();
    this.scoring.reset();
    this.waves.reset();
    this.viewmodel.reset();
    this.hud.reset();
    this.notifier.clear();
    this.dieT = 0;
  }

  dash() {
    const p = this.player;
    if (!p.tryDash(this.input.keys)) return;
    this.camRig.kickFov();
    this.audio.dash();
    for (let i = 0; i < 20; i++) {
      this.effects.emit(
        p.pos.x + (Math.random() - 0.5) * 1.2,
        p.pos.y + 0.2 + Math.random() * 1.6,
        p.pos.z + (Math.random() - 0.5) * 1.2,
        -p.dashDir.x * 4,
        0,
        -p.dashDir.z * 4,
        0.35,
        0,
        0.9,
        1,
        0,
        3,
      );
    }
  }

  onPlayerDeath() {
    this.state = GameState.DYING;
    this.dieT = 0;
    this.input.mouseDown = false;
    this.notifier.announce('SYSTEM FAILURE', '', 1400);
    this.audio.gameOver();
  }

  gameOver() {
    this.state = GameState.OVER;
    this.input.exitLock();
    const s = this.scoring;
    const newBest = this.settings.submitScore(s.score);
    this.menu.showStats({ score: s.score, wave: this.waves.wave, kills: s.kills, headshots: s.headshots, newBest });
    this.menu.setBest(this.settings.best);
    this.menu.show('over');
  }

  /** Plays a world sound panned and attenuated by its position relative to the player. */
  playAt(sound, pos) {
    const p = this.player;
    const dx = pos.x - p.pos.x;
    const dz = pos.z - p.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const lx = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
    this.audio[sound](clamp(lx / dist, -1, 1) * 0.8, clamp(1 - dist / 90, 0.12, 1));
  }

  /* ───────────── frame ───────────── */

  _frame(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min((now - this.lastT) / 1000, 0.05);
    this.lastT = now;
    this.realTime += dt;
    if (this.state === GameState.PLAYING || this.state === GameState.DYING) this.update(dt);
    else if (this.state === GameState.MENU) this._attract(dt);
    this.render();
  }

  _attract(dt) {
    this.camRig.attract(dt, this.player, this.realTime);
    this.world.update(dt * 0.5);
    this.viewmodel.setVisible(false);
  }

  update(dt) {
    const playing = this.state === GameState.PLAYING;
    const dying = this.state === GameState.DYING;
    const p = this.player;

    p.tick(dt, playing);
    this.combat.tick(dt);
    this.scoring.tick(dt);
    if (playing && this.input.mouseDown) this.combat.fire();

    if (playing) {
      p.turn(this.input.keys, dt);
      const ev = p.move(dt, this.input.keys, this._obstacles());
      if (ev.jumped) this.audio.jump();
      if (ev.landed) this.audio.land();
    } else {
      p.coast(dt);
    }

    const wdt = this.time.update(dt, p, dying);
    this.audio.setTimeScale(this.time.scale);

    this.enemies.update(dt, wdt);
    this.projectiles.update(wdt, this);
    this.combat.updateThrown(dt);
    this.barrels.update(wdt, this.realTime, (b) => this.combat.explodeBarrel(b));
    this.world.update(wdt);
    this.effects.update(dt, wdt, this.time.scale);
    if (playing) this.waves.update(dt);

    this.camRig.update(dt, p, this.input.keys, { playing, dying, dieT: this.dieT, realTime: this.realTime });
    this.viewmodel.update(dt, p, this.combat.fireCd <= 0, dying);

    if (dying && (this.dieT += dt) > 1.6) this.gameOver();
    this._updateHud(dt);
  }

  _obstacles() {
    const out = [];
    for (const b of this.barrels.items) if (b.alive) out.push({ x: b.pos.x, z: b.pos.z, r: TUNE.barrelRadius });
    for (const e of this.enemies.alive()) out.push({ x: e.pos.x, z: e.pos.z, r: e.radius });
    return out;
  }

  _updateHud(dt) {
    const p = this.player;
    const s = this.scoring;
    this.hud.update(dt, {
      score: s.score,
      enemies: this.enemies.aliveCount,
      wave: this.waves.wave,
      hp: p.hp,
      maxHp: TUNE.maxHp,
      dashPct: (1 - p.dashCd / TUNE.dashCooldown) * 100,
      timeScale: this.time.scale,
      frozen: this.time.frozen,
      combo: s.comboActive ? s.multiplier : 0,
      comboFrac: s.comboActive ? s.comboT / TUNE.comboWindow : 0,
      crosshairGap: 5 + Math.min(1, p.speed / TUNE.walkSpeed) * 6 + this.viewmodel.recoil * 8 + (p.onGround ? 0 : 5),
    });
    this.radar.update(dt, {
      grid: this.grid,
      player: p,
      barrels: this.barrels.items,
      enemies: this.enemies.list,
      bullets: this.projectiles.active,
      time: this.realTime,
    });
  }

  render() {
    const hp = this.player.hp;
    this.pipeline.render({
      slow: this.state === GameState.MENU ? 0.3 : clamp((0.55 - this.time.scale) / 0.5, 0, 1),
      damage: this.camRig.damageFx,
      lowHp: hp < 35 ? 1 - hp / 35 : 0,
      time: this.realTime,
    });
  }
}
