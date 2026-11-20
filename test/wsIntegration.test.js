import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createKempServer } from '../server/index.js';

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const parsed = JSON.parse(String(raw));
      if (waiters.length > 0) {
        const w = waiters.shift();
        w(parsed);
      } else {
        queue.push(parsed);
      }
    });

    ws.nextMessage = (predicate, timeoutMs = 3000) =>
      new Promise((res, rej) => {
        const idx = queue.findIndex(predicate);
        if (idx !== -1) {
          return res(queue.splice(idx, 1)[0]);
        }
        const timer = setTimeout(() => rej(new Error('Timed out waiting for WS message')), timeoutMs);
        const check = (msg) => {
          if (predicate(msg)) {
            clearTimeout(timer);
            res(msg);
          } else {
            queue.push(msg);
            waiters.push(check);
          }
        };
        waiters.push(check);
      });

    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

test('End-to-end WebSocket multiplayer room, bot fill, secret huddle, and live table play', async () => {
  const { server, wss } = createKempServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const { port } = server.address();

  try {
    // Verify /healthz Cloud Run endpoint
    const healthRes = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'ok');

    // Connect Host + Partner over real WebSockets
    const hostWs = await openSocket(port);
    await hostWs.nextMessage((m) => m.type === 'welcome');

    hostWs.send(JSON.stringify({ type: 'create_room', name: 'Neeraj' }));
    const joined = await hostWs.nextMessage((m) => m.type === 'joined');
    assert.equal(joined.roomCode.length, 4);

    const partnerWs = await openSocket(port);
    await partnerWs.nextMessage((m) => m.type === 'welcome');
    partnerWs.send(JSON.stringify({ type: 'join_room', code: joined.roomCode, name: 'Maya' }));
    await partnerWs.nextMessage((m) => m.type === 'joined');

    // Configure 3 teams (6 seats), fill empty seats with bots, and start match
    hostWs.send(
      JSON.stringify({
        type: 'update_settings',
        settings: {
          numTeams: 3,
          notKempMode: 'specific',
          kempScoringMode: 'earn',
          meetUrl: 'https://meet.google.com/xyz-abcd-efg',
        },
      })
    );
    hostWs.send(JSON.stringify({ type: 'fill_bots' }));
    hostWs.send(JSON.stringify({ type: 'start_match' }));

    const huddleStateMsg = await partnerWs.nextMessage(
      (m) => m.type === 'room_state' && m.state.phase === 'huddle'
    );
    assert.equal(huddleStateMsg.state.teams.length, 3);
    assert.equal(huddleStateMsg.state.settings.meetUrl, 'https://meet.google.com/xyz-abcd-efg');

    // Ready both humans -> enters countdown
    hostWs.send(JSON.stringify({ type: 'huddle_ready' }));
    partnerWs.send(JSON.stringify({ type: 'huddle_ready' }));

    const dealtMsg = await hostWs.nextMessage(
      (m) => m.type === 'room_state' && (m.state.phase === 'countdown' || m.state.phase === 'playing')
    );
    assert.equal(dealtMsg.state.centerCards.length, 4);

    hostWs.close();
    partnerWs.close();
  } finally {
    wss.close();
    await new Promise((res) => server.close(res));
  }
});
