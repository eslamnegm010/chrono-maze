/**
 * Minimal peer-to-peer transport interface:
 *   selfId · send(msg, targetId?) · onMessage(cb(msg, fromId)) · onPeerJoin(cb) · onPeerLeave(cb) · leave()
 *
 * - 'p2p'   : WebRTC via Trystero. Peers find each other through public
 *             signalling networks, then talk directly. No server, no cost.
 * - 'local' : BroadcastChannel between tabs of the same browser. Used for
 *             offline development and automated tests (?net=local).
 */
const APP_ID = 'chrono-maze-eslamnegm010-v1';

export async function createTransport(kind, roomCode) {
  return kind === 'local' ? new LocalTransport(roomCode) : createP2PTransport(roomCode);
}

async function createP2PTransport(roomCode) {
  // Loaded on demand so solo play never downloads the networking code.
  const { joinRoom, selfId } = await import('trystero');
  const room = joinRoom({ appId: APP_ID }, `room-${roomCode}`);
  const action = room.makeAction('m');
  return {
    selfId,
    send: (msg, target) => action.send(msg, target ? { target } : undefined),
    onMessage: (cb) => {
      action.onMessage = (data, meta) => cb(data, meta.peerId);
    },
    onPeerJoin: (cb) => {
      room.onPeerJoin = cb;
    },
    onPeerLeave: (cb) => {
      room.onPeerLeave = cb;
    },
    leave: () => room.leave(),
  };
}

class LocalTransport {
  constructor(roomCode) {
    this.selfId = Math.random().toString(36).slice(2, 10);
    this.peers = new Set();
    this.handlers = { message: () => {}, join: () => {}, leave: () => {} };
    this.channel = new BroadcastChannel(`chrono-maze-${roomCode}`);
    this.channel.onmessage = (e) => this._receive(e.data);
    this._post({ kind: 'join' });
    window.addEventListener('beforeunload', () => this.leave());
  }

  _post(packet) {
    this.channel.postMessage({ from: this.selfId, ...packet });
  }

  _receive({ from, to, kind, data }) {
    if (from === this.selfId || (to && to !== this.selfId)) return;
    if (kind === 'leave') {
      if (this.peers.delete(from)) this.handlers.leave(from);
      return;
    }
    if (!this.peers.has(from)) {
      this.peers.add(from);
      if (kind === 'join') this._post({ kind: 'hi', to: from });
      this.handlers.join(from);
    }
    if (kind === 'msg') this.handlers.message(data, from);
  }

  send(msg, target) {
    this._post({ kind: 'msg', to: target, data: msg });
  }
  onMessage(cb) {
    this.handlers.message = cb;
  }
  onPeerJoin(cb) {
    this.handlers.join = cb;
  }
  onPeerLeave(cb) {
    this.handlers.leave = cb;
  }
  leave() {
    this._post({ kind: 'leave' });
    this.channel.close();
  }
}
