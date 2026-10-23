import * as THREE from 'three';
import { TUNE } from '../config/tuning.js';
import { PLAYER_COLORS, colorByKey, sanitizeName } from '../config/players.js';

const r2 = (v) => Math.round(v * 100) / 100;
const v3 = (v) => [r2(v.x), r2(v.y), r2(v.z)];
const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * Host-authoritative co-op over a peer-to-peer transport.
 *
 * The room creator is the host: their browser runs the real simulation
 * (enemies, bullets, waves, damage) and broadcasts snapshots at TUNE.netRate.
 * Clients move their own player locally (instant response), send their state
 * to the host, and render replicas of everything else.
 *
 * Messages (`t` field):
 *   client → host : hello · st (player state) · fire · throw
 *   host → client : welcome · roster · snap · fx · feed · ann · wave · hit · hc · revive · over · restart
 */
export class NetSession {
  constructor(game, role, code, transport) {
    this.game = game;
    this.role = role;
    this.code = code;
    this.t = transport;
    this.selfId = transport.selfId;
    this.hostId = role === 'host' ? this.selfId : null;
    this.joined = role === 'host';
    this.roster = new Map(); // id → { name, color }
    this.acc = 0;
    if (this.isHost) this.roster.set(this.selfId, { name: game.identity.name, color: game.identity.color.key });

    transport.onMessage((m, from) => this._onMessage(m, from));
    transport.onPeerJoin((id) => {
      if (!this.isHost) this.t.send({ t: 'hello', name: game.identity.name, color: game.identity.color.key }, id);
    });
    transport.onPeerLeave((id) => this._onPeerLeave(id));
  }

  get isHost() {
    return this.role === 'host';
  }

  get playerCount() {
    return this.roster.size;
  }

  get inviteUrl() {
    return `${location.origin}${location.pathname}?room=${this.code}`;
  }

  /* ───────────── sending ───────────── */

  /** Host only: send an event to every client. */
  broadcastEvent(msg) {
    if (this.isHost) this.t.send(msg);
  }

  sendTo(id, msg) {
    this.t.send(msg, id);
  }

  sendFire(o, d, muzzle) {
    this.sendTo(this.hostId, { t: 'fire', o: v3(o), d: [d.x, d.y, d.z], m: v3(muzzle) });
  }

  sendThrow(o, vel) {
    this.sendTo(this.hostId, { t: 'throw', o: v3(o), v: v3(vel) });
  }

  sendHit(id, dmg, fromX, fromZ) {
    this.sendTo(id, { t: 'hit', dmg, x: r2(fromX), z: r2(fromZ) });
  }

  update(dt) {
    this.acc += dt;
    if (this.acc < 1 / TUNE.netRate) return;
    this.acc = 0;
    if (this.isHost) this.t.send(this._snapshot());
    else if (this.joined) this.sendTo(this.hostId, { t: 'st', s: this._localState() });
  }

  leave() {
    try {
      this.t.leave();
    } catch {
      // Already disconnected.
    }
  }

  /* ───────────── state encoding ───────────── */

  _localState() {
    const g = this.game;
    const p = g.player;
    return [
      r2(p.pos.x),
      r2(p.pos.y),
      r2(p.pos.z),
      r2(p.yaw),
      r2(p.pitch),
      r2(p.vel.x),
      r2(p.vel.z),
      r2(g.time.scale),
      Math.ceil(p.hp),
      p.down ? 1 : 0,
      r2(p.invuln),
    ];
  }

  _snapshot() {
    const g = this.game;
    const players = [[this.selfId, ...this._localState(), r2(g.reviveFracOf(this.selfId))]];
    for (const a of g.avatars.values()) {
      players.push([
        a.id,
        r2(a.pos.x),
        r2(a.pos.y),
        r2(a.pos.z),
        r2(a.yaw),
        r2(a.pitch),
        r2(a.vel.x),
        r2(a.vel.z),
        r2(a.ts),
        a.hp,
        a.down ? 1 : 0,
        r2(a.invuln),
        r2(g.reviveFracOf(a.id)),
      ]);
    }
    const s = g.scoring;
    return {
      t: 'snap',
      e: g.enemies.snapshot(),
      b: g.projectiles.snapshot(),
      br: g.barrels.items.map((b) => (b.alive ? 1 : 0)).join(''),
      p: players,
      w: g.waves.wave,
      s: s.score,
      k: s.kills,
      h: s.headshots,
      c: s.comboActive ? s.multiplier : 0,
      ct: s.comboActive ? r2(s.comboT) : 0,
    };
  }

  _applySnapshot(m) {
    const g = this.game;
    g.enemies.applySnapshot(m.e);
    g.projectiles.applySnapshot(m.b, g);
    g.barrels.items.forEach((b, i) => {
      const alive = m.br[i] === '1';
      if (alive !== b.alive) {
        b.alive = alive;
        b.mesh.visible = alive;
      }
    });
    for (const row of m.p) {
      const [id, ...state] = row;
      if (id === this.selfId) g.localReviveFrac = state[11];
      else g.avatars.applyState(id, state);
    }
    g.waves.wave = m.w;
    const s = g.scoring;
    s.score = m.s;
    s.kills = m.k;
    s.headshots = m.h;
    s.combo = m.c;
    s.comboT = m.ct;
  }

  _broadcastRoster() {
    this.t.send({ t: 'roster', list: [...this.roster].map(([id, r]) => [id, r.name, r.color]) });
  }

  _applyRoster(list) {
    const g = this.game;
    const ids = new Set();
    this.roster.clear();
    for (const [id, name, color] of list) {
      this.roster.set(id, { name, color });
      if (id === this.selfId) continue;
      ids.add(id);
      g.avatars.upsert(id, name, color);
    }
    for (const a of [...g.avatars.values()]) if (!ids.has(a.id)) g.avatars.remove(a.id);
  }

  /* ───────────── receiving ───────────── */

  _shooter(id) {
    const r = this.roster.get(id);
    return { id, name: r?.name ?? '?', color: colorByKey(r?.color).hex };
  }

  _onMessage(m, from) {
    if (!m || typeof m.t !== 'string') return;
    if (this.isHost) this._onHostMessage(m, from);
    else if (from === this.hostId || m.t === 'welcome') this._onClientMessage(m, from);
  }

  _onHostMessage(m, from) {
    const g = this.game;
    switch (m.t) {
      case 'hello': {
        if (this.roster.size >= TUNE.maxPlayers && !this.roster.has(from)) {
          this.sendTo(from, { t: 'full' });
          return;
        }
        const { name, color } = this._claimIdentity(from, m.name, m.color);
        this.roster.set(from, { name, color });
        g.avatars.upsert(from, name, color);
        this.sendTo(from, { t: 'welcome', name, color, wave: g.waves.wave });
        this._broadcastRoster();
        g.ui.feed(`${name} دخل الأوضة`, 'yellow');
        break;
      }
      case 'st':
        if (this.roster.has(from) && Array.isArray(m.s)) g.avatars.applyState(from, m.s);
        break;
      case 'fire':
        if (this.roster.has(from) && !g.avatars.get(from)?.down)
          g.combat.resolveShot(vec(m.o), vec(m.d).normalize(), vec(m.m), this._shooter(from));
        break;
      case 'throw':
        if (this.roster.has(from)) g.combat.launch(vec(m.o), vec(m.v), this._shooter(from));
        break;
    }
  }

  /** Unique name and a free colour (the requested one if nobody has it). */
  _claimIdentity(id, rawName, colorKey) {
    let name = sanitizeName(rawName);
    const taken = [...this.roster].filter(([pid]) => pid !== id);
    const names = new Set(taken.map(([, r]) => r.name));
    for (let n = 2; names.has(name); n++) name = `${sanitizeName(rawName).slice(0, 13)} ${n}`;
    const colors = new Set(taken.map(([, r]) => r.color));
    let color = colorByKey(colorKey).key;
    if (colors.has(color)) color = (PLAYER_COLORS.find((c) => !colors.has(c.key)) ?? PLAYER_COLORS[0]).key;
    return { name, color };
  }

  _onClientMessage(m, from) {
    const g = this.game;
    switch (m.t) {
      case 'welcome':
        if (this.joined) return;
        this.hostId = from;
        this.joined = true;
        g.onJoined(m.name, m.color);
        break;
      case 'full':
        g.onJoinFailed('الأوضة مليانة');
        break;
      case 'roster':
        this._applyRoster(m.list);
        break;
      case 'snap':
        this._applySnapshot(m);
        break;
      case 'fx':
        g.applyRemoteFx(m);
        break;
      case 'feed':
        g.notifier.feed(m.x, m.c);
        break;
      case 'ann':
        g.notifier.announce(m.x, m.c, m.ms);
        break;
      case 'wave':
        g.audio.wave();
        break;
      case 'hit':
        g.combat.hurtPlayer(m.dmg, m.x, m.z);
        break;
      case 'hc':
        g.confirmHit({ id: this.selfId }, m.k, m.h);
        break;
      case 'revive':
        g.revive();
        break;
      case 'over':
        g.gameOver(m.stats);
        break;
      case 'restart':
        g.onRestartedByHost();
        break;
    }
  }

  _onPeerLeave(id) {
    const g = this.game;
    if (!this.isHost) {
      if (id === this.hostId) g.onHostLost();
      return;
    }
    const r = this.roster.get(id);
    if (!r) return;
    this.roster.delete(id);
    g.avatars.remove(id);
    this._broadcastRoster();
    g.ui.feed(`${r.name} خرج`, '');
  }
}
