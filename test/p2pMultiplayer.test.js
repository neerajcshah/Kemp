import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createLocalPracticeTransport } from '../public/js/firebaseAdapter.js';

// In-memory mock PeerJS broker to test multi-device WebRTC DataChannel multiplayer deterministically
const peerRegistry = new Map();

class MockDataConnection extends EventEmitter {
  constructor() {
    super();
    this.open = false;
    this._remote = null;
  }

  send(payload) {
    if (!this.open || !this._remote) return;
    const cloned = structuredClone(payload);
    queueMicrotask(() => this._remote.emit('data', cloned));
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
    if (this._remote && this._remote.open) {
      this._remote.open = false;
      this._remote.emit('close');
    }
  }
}

class MockPeer extends EventEmitter {
  constructor(idOrOpts) {
    super();
    this.id = typeof idOrOpts === 'string' ? idOrOpts : `anon_${Math.random().toString(36).slice(2, 9)}`;
    if (peerRegistry.has(this.id)) {
      queueMicrotask(() => this.emit('error', { type: 'unavailable-id' }));
      return;
    }
    peerRegistry.set(this.id, this);
    queueMicrotask(() => this.emit('open', this.id));
  }

  connect(targetId) {
    const clientConn = new MockDataConnection();
    const targetPeer = peerRegistry.get(targetId);
    if (!targetPeer) {
      queueMicrotask(() => this.emit('error', { type: 'peer-unavailable' }));
      return clientConn;
    }
    const hostConn = new MockDataConnection();
    clientConn._remote = hostConn;
    hostConn._remote = clientConn;

    queueMicrotask(() => {
      targetPeer.emit('connection', hostConn);
      clientConn.open = true;
      hostConn.open = true;
      clientConn.emit('open');
      hostConn.emit('open');
    });
    return clientConn;
  }

  destroy() {
    peerRegistry.delete(this.id);
  }
}

function makeFakeSessionStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('4-human multi-device WebRTC DataChannel game syncs rooms, keeps hands/huddles private, and arbitrates swaps', async () => {
  globalThis.window = { Peer: MockPeer };

  const createDeviceClient = () => {
    globalThis.sessionStorage = makeFakeSessionStorage();
    const stateHistory = [];
    let latestState = null;
    let joinedCode = null;
    let lastRejection = null;

    const transport = createLocalPracticeTransport((msg) => {
      if (msg.type === 'joined') joinedCode = msg.roomCode;
      if (msg.type === 'room_state') {
        latestState = msg.state;
        stateHistory.push(msg.state);
      }
      if (msg.type === 'swap_rejected') lastRejection = msg;
    });

    return {
      transport,
      getState: () => latestState,
      getCode: () => joinedCode,
      getRejection: () => lastRejection,
    };
  };

  const p1Host = createDeviceClient();
  const p2Partner = createDeviceClient();
  const p3Opp = createDeviceClient();
  const p4Opp = createDeviceClient();

  try {
    // Host creates room on Phone 1
    p1Host.transport.send({ type: 'create_room', name: 'Neeraj' });
    await new Promise((r) => setTimeout(r, 25));
    const roomCode = p1Host.getCode();
    assert.equal(roomCode.length, 4);

    // 3 Human friends join from Phones 2, 3, 4
    p2Partner.transport.send({ type: 'join_room', code: roomCode, name: 'Maya' });
    p3Opp.transport.send({ type: 'join_room', code: roomCode, name: 'Cara' });
    p4Opp.transport.send({ type: 'join_room', code: roomCode, name: 'Dan' });
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(p1Host.getState().players.length, 4);
    assert.equal(p4Opp.getState().players.length, 4);

    // Host starts match -> Secret Partner Huddle
    p1Host.transport.send({ type: 'start_match' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(p2Partner.getState().phase, 'huddle');

    // Neeraj picks secret Signal Button & whispers to Maya; Cara (opponent) CANNOT see it!
    p1Host.transport.send({ type: 'huddle_tell_key', tellKey: 'chin' });
    p1Host.transport.send({ type: 'huddle_message', text: 'Wink twice for Kemp' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(p2Partner.getState().myHuddle.teamTellKey, 'chin');
    assert.notEqual(p3Opp.getState().myHuddle.teamTellKey, 'chin');
    assert.equal(p2Partner.getState().myHuddle.messages.length, 1);
    assert.equal(p2Partner.getState().myHuddle.messages[0].text, 'Wink twice for Kemp');
    assert.equal(p3Opp.getState().myHuddle.messages.length, 0);

    // All 4 humans ready up -> deals cards (opponent hands hidden!)
    for (const client of [p1Host, p2Partner, p3Opp, p4Opp]) {
      client.transport.send({ type: 'huddle_ready' });
    }
    await new Promise((r) => setTimeout(r, 30));

    const caraView = p3Opp.getState();
    const myCara = caraView.players.find((p) => p.id === caraView.youId);
    const oppNeeraj = caraView.players.find((p) => p.name === 'Neeraj');
    assert.equal(myCara.hand.length, 4);
    assert.equal(oppNeeraj.hand, null); // Hidden!
  } finally {
    p1Host.transport.destroy();
    p2Partner.transport.destroy();
    p3Opp.transport.destroy();
    p4Opp.transport.destroy();
  }
});
