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

test('Guest refresh/reconnect does not drop center-card broadcasts when old DataConnection closes late', async () => {
  globalThis.window = { Peer: MockPeer };

  const makeClientWithStorage = (storage) => {
    globalThis.sessionStorage = storage;
    let latestState = null;
    let joinedCode = null;
    let lastRejection = null;

    const transport = createLocalPracticeTransport((msg) => {
      if (msg.type === 'joined') joinedCode = msg.roomCode;
      if (msg.type === 'room_state') latestState = msg.state;
      if (msg.type === 'swap_rejected') lastRejection = msg;
    });

    return {
      transport,
      storage,
      getState: () => latestState,
      getCode: () => joinedCode,
      getRejection: () => lastRejection,
    };
  };

  const p1Host = makeClientWithStorage(makeFakeSessionStorage());
  const p2Storage = makeFakeSessionStorage();
  const p2OldTab = makeClientWithStorage(p2Storage);
  const p3Opp = makeClientWithStorage(makeFakeSessionStorage());
  const p4Opp = makeClientWithStorage(makeFakeSessionStorage());
  let p2RefreshedTab = null;

  try {
    p1Host.transport.send({ type: 'create_room', name: 'Host' });
    await new Promise((r) => setTimeout(r, 25));
    const code = p1Host.getCode();

    p2OldTab.transport.send({ type: 'join_room', code, name: 'Grandma' });
    p3Opp.transport.send({ type: 'join_room', code, name: 'Uncle' });
    p4Opp.transport.send({ type: 'join_room', code, name: 'Aunt' });
    await new Promise((r) => setTimeout(r, 40));

    // Start match and ready everyone
    p1Host.transport.send({ type: 'start_match' });
    await new Promise((r) => setTimeout(r, 25));
    for (const c of [p1Host, p2OldTab, p3Opp, p4Opp]) {
      c.transport.send({ type: 'huddle_ready' });
    }

    // Grandma refreshes her tab: new tab connects BEFORE old WebRTC connection finishes timing out!
    p2RefreshedTab = makeClientWithStorage(p2Storage);
    p2RefreshedTab.transport.send({ type: 'join_room', code, name: 'Grandma' });
    await new Promise((r) => setTimeout(r, 35));

    // Old tab's connection finally closes late (previously this deleted Grandma's new conn from guestConns!)
    p2OldTab.transport.destroy();
    await new Promise((r) => setTimeout(r, 2400)); // Finish countdown -> phase === 'playing'

    assert.equal(p1Host.getState().phase, 'playing');
    assert.equal(p2RefreshedTab.getState().phase, 'playing');

    // Host swaps center slot 0 -> ALL guests (including refreshed Grandma!) must receive updated centerCards!
    const hostHandCard = p1Host.getState().players.find((p) => p.id === p1Host.getState().youId).hand[0];
    const initialCenter0 = p1Host.getState().centerCards[0];
    p1Host.transport.send({
      type: 'swap_card',
      handCardId: hostHandCard.id,
      centerIndex: 0,
      expectedCenterCardId: initialCenter0.id,
    });
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(p1Host.getState().centerCards[0].id, hostHandCard.id);
    assert.equal(p2RefreshedTab.getState().centerCards[0].id, hostHandCard.id);
    assert.equal(p3Opp.getState().centerCards[0].id, hostHandCard.id);
    assert.equal(p4Opp.getState().centerCards[0].id, hostHandCard.id);

    // Now Uncle swaps center slot 1 -> Host, Grandma, and Aunt all see Uncle's discarded card in slot 1!
    const uncleHandCard = p3Opp.getState().players.find((p) => p.id === p3Opp.getState().youId).hand[0];
    const center1Before = p3Opp.getState().centerCards[1];
    p3Opp.transport.send({
      type: 'swap_card',
      handCardId: uncleHandCard.id,
      centerIndex: 1,
      expectedCenterCardId: center1Before.id,
    });
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(p1Host.getState().centerCards[1].id, uncleHandCard.id);
    assert.equal(p2RefreshedTab.getState().centerCards[1].id, uncleHandCard.id);
    assert.equal(p4Opp.getState().centerCards[1].id, uncleHandCard.id);

    // Simulate photo-finish race loss by Aunt expecting old center1Before -> gets swap_rejected AND fresh state!
    const auntHandCard = p4Opp.getState().players.find((p) => p.id === p4Opp.getState().youId).hand[0];
    p4Opp.transport.send({
      type: 'swap_card',
      handCardId: auntHandCard.id,
      centerIndex: 1,
      expectedCenterCardId: center1Before.id,
    });
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(p4Opp.getRejection()?.code, 'RACE_LOST');
    assert.equal(p4Opp.getState().centerCards[1].id, uncleHandCard.id);
  } finally {
    p1Host.transport.destroy();
    p2OldTab.transport.destroy();
    if (p2RefreshedTab) p2RefreshedTab.transport.destroy();
    p3Opp.transport.destroy();
    p4Opp.transport.destroy();
  }
});
