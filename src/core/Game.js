import { TUNE } from '../config/tuning.js';
import { colorByKey, normalizeRoomCode, randomName, randomRoomCode, sanitizeName } from '../config/players.js';
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
import { RemotePlayers } from '../entities/RemotePlayers.js';
import { EnemyManager } from '../systems/EnemyManager.js';
import { EnemyProjectiles } from '../systems/EnemyProjectiles.js';
import { WaveDirector } from '../systems/WaveDirector.js';
import { Combat } from '../systems/Combat.js';
import { Scoring } from '../systems/Scoring.js';
import { TimeController } from '../systems/TimeController.js';
import { TimeField } from '../systems/TimeField.js';
import { CameraRig } from '../systems/CameraRig.js';
import { Viewmodel } from '../weapon/Viewmodel.js';
import { Input } from '../input/Input.js';
import { Hud } from '../ui/Hud.js';
import { Radar } from '../ui/Radar.js';
import { Notifier } from '../ui/Notifier.js';
import { Menu } from '../ui/Menu.js';
import { createTransport } from '../net/transport.js';
import { NetSession } from '../net/NetSession.js';

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * Composition root and state machine. Builds every subsystem, wires input to
 * intents, and runs the frame loop. Subsystems receive the Game as a shared
 * context (grid, player, time, audio, effects…) rather than importing each other.
 *
 * Modes:
 *   solo   — everything local (the original game)
 *   host   — runs the authoritative simulation and serves other players
 *   client — moves its own player, mirrors everything else from the host
 */
export class Game {
  constructor(doc, level) {
    this.doc = doc;
    this.level = level;
    this.state = GameState.MENU;
    this.mode = 'solo';
    this.net = null;
    this.realTime = 0;
    this.dieT = 0;
    this.reviveT = new Map();
    this.localReviveFrac = 0;

    this.settings = new Settings();
    const sv = this.settings.values;
    this.identity = { name: sanitizeName(sv.name || randomName()), color: colorByKey(sv.color) };
    this.audio = new SoundEngine();
    this.audio.volume = sv.vol;

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
    this.avatars = new RemotePlayers(this.scene, this.assets);

    this.notifier = new Notifier(doc);
    this.hud = new Hud(doc);
    this.radar = new Radar(doc.getElementById('radar-canvas'));
    this.ui = this._uiFacade();
    this.fx = this._fxFacade();

    this.player = new Player(this.grid, level.spawn);
    this.player.name = this.identity.name;
    this.time = new TimeController();
    this.timeField = new TimeField();
    this.camRig = new CameraRig(this.camera);
    this.scoring = new Scoring(this.ui);
    this.enemies = new EnemyManager(this);
    this.waves = new WaveDirector(this);
    this.combat = new Combat(this);

    this.menu = new Menu(doc, this.settings, this.identity, {
      onSolo: () => this.startSolo(),
      onHost: () => this.startHost(),
      onJoin: (code) => this.startJoin(code),
      onMain: (mode) => this._onMenuMain(mode),
      onRestart: () => this._restart(),
      onLeave: () => this.leaveRoom(),
      onCopyInvite: () => this.copyInvite(),
      onSetting: (key, value) => this.applySetting(key, value),
      onIdentity: (name, colorKey) => this.setIdentity(name, colorKey),
    });
    this.pipeline.setBloom(sv.bloom);
    if (!this.pipeline.composer) this.menu.disableBloom();

    this.input = new Input(this.pipeline.canvas, this._inputHandlers());

    this.resetRun();
    const params = new URLSearchParams(location.search);
    this.netKind = params.get('net') === 'local' ? 'local' : 'p2p';
    this.menu.show('menu', { inviteCode: normalizeRoomCode(params.get('room')) });
    this.hud.setVisible(false);
    this._loop = (t) => this._frame(t);
  }

  start() {
    this.lastT = performance.now();
    requestAnimationFrame(this._loop);
  }

  /* ───────────── mode helpers ───────────── */

  get isMultiplayer() {
    return this.mode !== 'solo';
  }
  get isClient() {
    return this.mode === 'client';
  }
  get selfId() {
    return this.net?.selfId ?? 'local';
  }
  /** Is the shared world advancing? (In multiplayer it never stops for one player's pause menu.) */
  get simRunning() {
    return this.state === GameState.PLAYING || (this.isMultiplayer && this.state === GameState.PAUSED);
  }

  /** Every player body in the world (local + remote), downed ones included. */
  bodies() {
    const out = [this.player];
    for (const a of this.avatars.values()) if (a.seen) out.push(a);
    return out;
  }

  /** Players enemies may hunt and shoot. */
  targets() {
    return this.bodies().filter((b) => !b.down);
  }

  targetById(id) {
    if (!id) return null;
    if (id === this.selfId) return this.player;
    return this.avatars.get(id) ?? null;
  }

  reviveFracOf(id) {
    return (this.reviveT.get(id) ?? 0) / TUNE.reviveTime;
  }

  /* ───────────── facades: local effect + broadcast to clients when hosting ───────────── */

  _uiFacade() {
    return {
      feed: (text, color) => {
        this.notifier.feed(text, color);
        this.net?.broadcastEvent({ t: 'feed', x: text, c: color });
      },
      announce: (text, color, ms) => {
        this.notifier.announce(text, color, ms);
        this.net?.broadcastEvent({ t: 'ann', x: text, c: color, ms });
      },
    };
  }

  _fxFacade() {
    const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
    return {
      tracer: (a, b, color, shooterId) => {
        this.effects.tracer(a, b, color);
        this.net?.broadcastEvent({ t: 'fx', k: 'tr', a: v3(a), b: v3(b), c: color, s: shooterId });
      },
      explosion: (pos) => {
        this._explosionFx(pos);
        this.net?.broadcastEvent({ t: 'fx', k: 'ex', p: v3(pos) });
      },
      shatter: (pos, scale, dir, paletteKey, head) => {
        this._shatterFx(pos, scale, dir, paletteKey, head);
        this.net?.broadcastEvent({ t: 'fx', k: 'sh', p: v3(pos), sc: scale, d: v3(dir), pk: paletteKey, h: head ? 1 : 0 });
      },
    };
  }

  _explosionFx(pos) {
    this.effects.explosion(pos, TUNE.blastRadius);
    this.playAt('explosion', pos);
  }

  _shatterFx(pos, scale, dir, paletteKey, head) {
    this.effects.shatter(pos, scale, dir, this.assets.palettes[paletteKey] ?? this.assets.palettes.grunt);
    this.playAt('shatter', pos);
    if (head) this.effects.burst(pos.x, TUNE.headY * scale, pos.z, 25, 6, 0xffffff, { life: 0.5 });
  }

  /** Client: replay an effect the host broadcast. */
  applyRemoteFx(m) {
    const P = (a) => ({ x: a[0], y: a[1], z: a[2] });
    if (m.k === 'tr' && m.s !== this.selfId) {
      this.effects.tracer(P(m.a), P(m.b), m.c);
    } else if (m.k === 'ex') {
      const pos = P(m.p);
      this._explosionFx(pos);
      const d = Math.hypot(pos.x - this.player.pos.x, pos.z - this.player.pos.z);
      this.camRig.addTrauma(clamp(1 - d / 40, 0.1, 0.9));
    } else if (m.k === 'sh') {
      this._shatterFx(P(m.p), m.sc, P(m.d), m.pk, m.h);
    }
  }

  /** Hit feedback for whoever fired: local hitmarker + sound, or a message to that client. */
  confirmHit(shooter, kill, head = false) {
    if (!shooter?.id) return;
    if (shooter.id === this.selfId) {
      this.notifier.hitmarker(kill);
      if (head) this.audio.headshot();
      else this.audio.hit();
    } else {
      this.net?.sendTo(shooter.id, { t: 'hc', k: kill, h: head });
    }
  }

  /* ───────────── menus & flow ───────────── */

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
        if (locked && this.state !== GameState.PLAYING && this.state !== GameState.DYING && this.state !== GameState.OVER) this.beginPlay();
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

  setIdentity(name, colorKey) {
    this.identity.name = sanitizeName(name);
    this.identity.color = colorByKey(colorKey);
    this.player.name = this.identity.name;
    this.settings.set('name', this.identity.name);
    this.settings.set('color', this.identity.color.key);
  }

  startSolo() {
    this.mode = 'solo';
    this.state = GameState.MENU;
    this.resetRun();
    this.requestPlay();
  }

  async startHost() {
    this.audio.init();
    const code = randomRoomCode();
    try {
      const transport = await createTransport(this.netKind, code);
      this._attachNet(new NetSession(this, 'host', code, transport), 'host');
    } catch (e) {
      console.error(e);
      this.notifier.toast('معرفتش أفتح أوضة أونلاين — جرّب تاني');
      return;
    }
    this._setRoomInUrl(code);
    this.resetRun();
    this.notifier.toast(`الأوضة ${code} جاهزة — ابعت اللينك من قائمة الإيقاف (Esc)`, 5000);
    this.requestPlay();
  }

  async startJoin(rawCode) {
    const code = normalizeRoomCode(rawCode);
    if (code.length < 4) {
      this.notifier.toast('اكتب كود الأوضة (4 حروف)');
      return;
    }
    this.audio.init();
    this.menu.show('connecting', { code });
    try {
      const transport = await createTransport(this.netKind, code);
      this._attachNet(new NetSession(this, 'client', code, transport), 'client');
    } catch (e) {
      console.error(e);
      this.onJoinFailed('مقدرتش أتصل — اتأكد من النت');
      return;
    }
    this._setRoomInUrl(code);
    clearTimeout(this._joinTimeout);
    this._joinTimeout = setTimeout(() => {
      if (!this.net?.joined) this.onJoinFailed(`مش لاقي أوضة ${code} — اتأكد من الكود إن صاحبها لسه جوه`);
    }, 20000);
  }

  _attachNet(net, mode) {
    this.net = net;
    this.mode = mode;
    this.player.id = net.selfId;
    this.avatars.setSelfColor(this.identity.color, true);
  }

  _setRoomInUrl(code) {
    const params = new URLSearchParams(location.search);
    params.set('room', code);
    history.replaceState(null, '', `${location.pathname}?${params}`);
  }

  onJoined(name, colorKey) {
    clearTimeout(this._joinTimeout);
    this.setIdentity(name, colorKey);
    this.menu.setIdentity(this.identity.name, this.identity.color.key);
    this.avatars.setSelfColor(this.identity.color, true);
    this.resetRun();
    this.menu.show('ready', { code: this.net.code });
  }

  onJoinFailed(message) {
    clearTimeout(this._joinTimeout);
    this.net?.leave();
    this.net = null;
    this.mode = 'solo';
    this.avatars.clear();
    this.avatars.setSelfColor(this.identity.color, false);
    this.menu.show('menu', {});
    this.notifier.toast(message, 5000);
  }

  onHostLost() {
    this.notifier.toast('صاحب الأوضة خرج — الجولة خلصت', 5000);
    this.gameOver(null, { hostLost: true });
  }

  leaveRoom() {
    this.net?.leave();
    location.href = location.pathname; // clean slate, no room in the URL
  }

  async copyInvite() {
    if (!this.net) return;
    const url = this.net.inviteUrl;
    try {
      await navigator.clipboard.writeText(url);
      this.notifier.toast('اتنسخ اللينك — ابعته لصحابك');
    } catch {
      window.prompt('انسخ اللينك ده:', url);
    }
  }

  _onMenuMain(mode) {
    if (mode === 'over') {
      if (this.isClient) return; // the host starts the next round
      this._restart();
      return;
    }
    this.requestPlay();
  }

  _restart() {
    if (this.isClient) return;
    this.state = GameState.MENU;
    this.resetRun();
    this.net?.broadcastEvent({ t: 'restart' });
    this.requestPlay();
  }

  onRestartedByHost() {
    this.state = GameState.MENU;
    this.resetRun();
    this.menu.show('ready', { code: this.net.code });
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
    this.hud.setRoom(this.net?.code ?? null);
    this.input.clear();
    this.viewmodel.setVisible(this.combat.gunReady && !this.player.down);
    this.lastT = performance.now();
    if (!this.isClient) this.waves.armFirstWave(1);
  }

  pause() {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.PAUSED;
    this.input.clear();
    this.menu.show('pause', { multiplayer: this.isMultiplayer, canRestart: !this.isClient, code: this.net?.code });
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
    this.reviveT.clear();
    this.localReviveFrac = 0;
    this.dieT = 0;
  }

  dash() {
    const p = this.player;
    if (p.down || !p.tryDash(this.input.keys)) return;
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

  /* ───────────── death & revive ───────────── */

  onPlayerDeath() {
    this.input.mouseDown = false;
    if (!this.isMultiplayer) {
      this.state = GameState.DYING;
      this.dieT = 0;
      this.notifier.announce('SYSTEM FAILURE', '', 1400);
      this.audio.gameOver();
      return;
    }
    this.player.down = true;
    this.viewmodel.setVisible(false);
    this.notifier.announce('اتوقعت!', '', 1400);
    this.audio.gameOver();
    if (!this.isClient) this.ui.feed(`${this.identity.name} وقع ⬇`, 'pink');
  }

  revive() {
    const p = this.player;
    if (!p.down) return;
    p.down = false;
    p.hp = TUNE.reviveHp;
    p.lastHit = 0;
    p.invuln = 1.5;
    this.localReviveFrac = 0;
    this.viewmodel.raiseGun();
    this.notifier.announce('رجعت! ⚡', 'cyan', 900);
  }

  /** Host: a downed player is revived by a teammate standing still next to them. */
  _updateRevives(dt) {
    const bodies = this.bodies();
    const scaleOf = (b) => (b === this.player ? this.time.scale : b.ts);
    for (const b of bodies) {
      if (!b.down) {
        this.reviveT.delete(b.id);
        continue;
      }
      const helper = bodies.find(
        (h) =>
          h !== b && !h.down && Math.hypot(h.pos.x - b.pos.x, h.pos.z - b.pos.z) < TUNE.reviveRadius && scaleOf(h) < TUNE.reviveStillScale,
      );
      let t = this.reviveT.get(b.id) ?? 0;
      t = helper ? t + dt : Math.max(0, t - dt * 0.5);
      if (t >= TUNE.reviveTime) {
        t = 0;
        this._reviveBody(b);
        this.ui.feed(`${helper.name} أنعش ${b.name} ⚡`, 'yellow');
      }
      this.reviveT.set(b.id, t);
    }
    if (this.state !== GameState.OVER && bodies.every((b) => b.down)) this._teamWiped();
  }

  _reviveBody(b) {
    if (b === this.player) this.revive();
    else {
      b.down = false;
      this.net?.sendTo(b.id, { t: 'revive' });
    }
  }

  onWaveCleared() {
    if (!this.isMultiplayer) return;
    for (const b of this.bodies()) if (b.down) this._reviveBody(b);
  }

  _teamWiped() {
    const s = this.scoring;
    const stats = { score: s.score, wave: this.waves.wave, kills: s.kills, headshots: s.headshots };
    this.net?.broadcastEvent({ t: 'over', stats });
    this.gameOver(stats);
  }

  gameOver(stats = null, { hostLost = false } = {}) {
    this.state = GameState.OVER;
    this.input.exitLock();
    const s = this.scoring;
    const result = stats ?? { score: s.score, wave: this.waves.wave, kills: s.kills, headshots: s.headshots };
    const newBest = this.settings.submitScore(result.score);
    this.menu.showStats({ ...result, newBest });
    this.menu.setBest(this.settings.best);
    this.menu.show('over', { canRestart: !this.isClient && !hostLost, hostLost, multiplayer: this.isMultiplayer });
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
    // rAF timestamps can precede a performance.now() taken during the previous task.
    const dt = clamp((now - this.lastT) / 1000, 0, 0.05);
    this.lastT = now;
    this.realTime += dt;
    if (this.state === GameState.PLAYING || this.state === GameState.DYING || (this.isMultiplayer && this.state === GameState.PAUSED))
      this.update(dt);
    else if (this.state === GameState.MENU) this._attract(dt);
    this.render();
  }

  _attract(dt) {
    this.camRig.attract(dt, this.player, this.realTime);
    this.world.update(dt * 0.5);
    this.viewmodel.setVisible(false);
  }

  _rebuildTimeField() {
    if (!this.isMultiplayer) {
      this.timeField.set(true, this.time.scale, []);
      return;
    }
    const sources = [];
    const p = this.player;
    if (!p.down) sources.push({ x: p.pos.x, z: p.pos.z, s: this.time.scale });
    for (const a of this.avatars.values()) if (a.seen && !a.down) sources.push({ x: a.pos.x, z: a.pos.z, s: a.ts });
    this.timeField.set(false, 0, sources);
  }

  update(dt) {
    const dying = this.state === GameState.DYING;
    const p = this.player;
    const controllable = this.state === GameState.PLAYING && !p.down;

    p.tick(dt, controllable);
    this.combat.tick(dt);
    this.scoring.tick(dt);
    if (controllable && this.input.mouseDown) this.combat.fire();

    if (controllable) {
      p.turn(this.input.keys, dt);
      const ev = p.move(dt, this.input.keys, this._obstacles());
      if (ev.jumped) this.audio.jump();
      if (ev.landed) this.audio.land();
    } else {
      p.coast(dt);
    }

    this.time.update(dt, p, dying || p.down);
    this.avatars.update(dt, p, this.time.scale);
    this._rebuildTimeField();
    const localScale = this.timeField.scaleAt(p.pos);
    const wdt = dt * localScale;
    this.audio.setTimeScale(localScale);

    if (this.isClient) {
      this.enemies.updateReplicas(dt);
      this.projectiles.updateReplicas(dt, this);
    } else {
      this.enemies.update(dt);
      this.projectiles.update(dt, this);
    }
    this.combat.updateThrown(dt);
    this.barrels.update(wdt, this.realTime, (b) => this.combat.explodeBarrel(b));
    this.world.update(wdt);
    this.effects.update(dt, wdt, localScale);
    if (!this.isClient && this.simRunning) {
      this.waves.update(dt);
      if (this.isMultiplayer) this._updateRevives(dt);
    }

    const downed = dying || p.down;
    this.camRig.update(dt, p, this.input.keys, {
      playing: controllable,
      dying: downed,
      dieT: dying ? this.dieT : 0.9,
      realTime: this.realTime,
    });
    this.viewmodel.update(dt, p, this.combat.fireCd <= 0, downed);
    this.net?.update(dt);

    if (dying && (this.dieT += dt) > 1.6) this.gameOver();
    this._updateHud(dt, localScale);
  }

  _obstacles() {
    const out = [];
    for (const b of this.barrels.items) if (b.alive) out.push({ x: b.pos.x, z: b.pos.z, r: TUNE.barrelRadius });
    for (const e of this.enemies.alive()) out.push({ x: e.pos.x, z: e.pos.z, r: e.radius });
    for (const a of this.avatars.values()) if (a.seen) out.push({ x: a.pos.x, z: a.pos.z, r: TUNE.playerRadius });
    return out;
  }

  _updateHud(dt, localScale) {
    const p = this.player;
    const s = this.scoring;
    this.hud.update(dt, {
      score: s.score,
      enemies: this.enemies.aliveCount,
      wave: this.waves.wave,
      hp: p.hp,
      maxHp: TUNE.maxHp,
      dashPct: (1 - p.dashCd / TUNE.dashCooldown) * 100,
      timeScale: localScale,
      frozen: localScale < 0.2,
      combo: s.comboActive ? s.multiplier : 0,
      comboFrac: s.comboActive ? s.comboT / TUNE.comboWindow : 0,
      crosshairGap: 5 + Math.min(1, p.speed / TUNE.walkSpeed) * 6 + this.viewmodel.recoil * 8 + (p.onGround ? 0 : 5),
      down: p.down,
      reviveFrac: this.isClient ? this.localReviveFrac : this.reviveFracOf(this.selfId),
      players: this.isMultiplayer ? this._playerRows() : null,
    });
    this.radar.update(dt, {
      grid: this.grid,
      player: p,
      barrels: this.barrels.items,
      enemies: this.enemies.list,
      bullets: this.projectiles.active,
      allies: this.avatars.values(),
      time: this.realTime,
    });
  }

  _playerRows() {
    const rows = [{ name: `${this.identity.name} (إنت)`, color: this.identity.color, hp: this.player.hp, down: this.player.down }];
    for (const a of this.avatars.values()) rows.push({ name: a.name, color: a.color, hp: a.hp, down: a.down });
    return rows;
  }

  render() {
    const hp = this.player.hp;
    const localScale = this.state === GameState.MENU ? this.time.scale : this.timeField.scaleAt(this.player.pos);
    this.pipeline.render({
      slow: this.state === GameState.MENU ? 0.3 : clamp((0.55 - localScale) / 0.5, 0, 1),
      damage: this.camRig.damageFx,
      lowHp: hp < 35 && !this.player.down ? 1 - hp / 35 : 0,
      time: this.realTime,
    });
  }
}
