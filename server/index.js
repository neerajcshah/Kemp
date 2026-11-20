import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  SIGNAL_SUGGESTIONS,
  TABLE_TELLS,
  addBotToSeat,
  addPlayerToRoom,
  beginCountdownAndDeal,
  callKemp,
  callNotKemp,
  createPlayerRecord,
  createRoom,
  fillEmptySeatsWithBots,
  finishCountdownIfReady,
  generateRoomCode,
  removePlayerFromRoom,
  resolveExpiredAccusationIfNeeded,
  returnToLobby,
  sanitizePlayerName,
  seatPlayer,
  sendHuddleMessage,
  serializeRoomForPlayer,
  setTeamSignalNote,
  startMatch,
  startRoundHuddle,
  swapCard,
  toggleFlushVote,
  toggleHuddleReady,
  triggerTableTell,
  updateRoomSettings,
} from './gameEngine.js';
import { tickRoomBots } from './botController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

export function createKempServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Rooms & active socket tracking
  const rooms = new Map(); // code -> room
  const playerSockets = new Map(); // `${roomCode}:${playerId}` -> Set<WebSocket>

  // Google Cloud Run health probe
  app.get('/healthz', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'kemp-online',
      activeRooms: rooms.size,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({
      tells: Object.values(TABLE_TELLS),
      signalSuggestions: SIGNAL_SUGGESTIONS,
    });
  });

  app.use(express.static(PUBLIC_DIR));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/ws' || pathname.endsWith('/ws')) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  function socketKey(roomCode, playerId) {
    return `${roomCode}:${playerId}`;
  }

  function sendJson(ws, payload) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }

  function broadcastRoom(room, extraEvent = null) {
    for (const player of room.players.values()) {
      if (player.isBot) continue;
      const key = socketKey(room.code, player.id);
      const sockets = playerSockets.get(key);
      if (!sockets || sockets.size === 0) continue;

      const state = serializeRoomForPlayer(room, player.id);
      for (const sock of sockets) {
        sendJson(sock, {
          type: 'room_state',
          state,
          event: extraEvent,
        });
      }
    }
  }

  function attachSocketToPlayer(ws, room, player) {
    detachSocket(ws);
    ws.roomCode = room.code;
    ws.playerId = player.id;
    player.connected = true;

    const key = socketKey(room.code, player.id);
    if (!playerSockets.has(key)) {
      playerSockets.set(key, new Set());
    }
    playerSockets.get(key).add(ws);
  }

  function detachSocket(ws) {
    if (!ws.roomCode || !ws.playerId) return;
    const room = rooms.get(ws.roomCode);
    const key = socketKey(ws.roomCode, ws.playerId);
    const set = playerSockets.get(key);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        playerSockets.delete(key);
        if (room) {
          const player = room.players.get(ws.playerId);
          if (player && !player.isBot) {
            player.connected = false;
            // Reassign host if host disconnected in lobby and another connected human exists
            if (room.hostId === player.id) {
              const nextHost = [...room.players.values()].find((p) => !p.isBot && p.connected);
              if (nextHost) room.hostId = nextHost.id;
            }
            broadcastRoom(room);
          }
        }
      }
    }
    ws.roomCode = null;
    ws.playerId = null;
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    sendJson(ws, {
      type: 'welcome',
      tells: Object.values(TABLE_TELLS),
      signalSuggestions: SIGNAL_SUGGESTIONS,
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        sendJson(ws, { type: 'error', message: 'Malformed message.' });
        return;
      }

      handleClientMessage(ws, msg);
    });

    ws.on('close', () => {
      detachSocket(ws);
    });
  });

  function handleClientMessage(ws, msg) {
    const { type } = msg || {};

    if (type === 'create_room') {
      const player = createPlayerRecord({
        name: msg.name,
        token: msg.token,
      });
      const code = generateRoomCode(new Set(rooms.keys()));
      const room = createRoom(code, player);
      rooms.set(code, room);

      if (msg.meetUrl) {
        updateRoomSettings(room, player.id, { meetUrl: msg.meetUrl });
      }

      attachSocketToPlayer(ws, room, player);

      if (msg.quickDemo) {
        fillEmptySeatsWithBots(room);
        startMatch(room, player.id);
      }

      sendJson(ws, {
        type: 'joined',
        roomCode: room.code,
        playerId: player.id,
        token: player.token,
      });
      broadcastRoom(room);
      return;
    }

    if (type === 'join_room') {
      const code = String(msg.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        sendJson(ws, {
          type: 'error',
          code: 'ROOM_NOT_FOUND',
          message: `Room "${code || '----'}" was not found. Check the 4-letter code or create a new table.`,
        });
        return;
      }

      // Check session reconnection by token
      let player = null;
      if (msg.token) {
        player = [...room.players.values()].find((p) => !p.isBot && p.token === msg.token) || null;
      }

      if (player) {
        if (msg.name) {
          player.name = sanitizePlayerName(msg.name, false);
        }
      } else {
        // If room is mid-game and a bot is occupying a seat, allow taking over if lobby; otherwise join as spectator or replace bot?
        if (room.phase !== 'lobby') {
          // Allow replacing a disconnected player or watching until lobby, or taking over a bot seat!
          const replaceableBot = [...room.players.values()].find((p) => p.isBot && p.teamIndex !== null);
          if (replaceableBot && msg.takeOverBot !== false) {
            player = createPlayerRecord({ name: msg.name, token: msg.token });
            player.teamIndex = replaceableBot.teamIndex;
            player.seatIndex = replaceableBot.seatIndex;
            player.hand = replaceableBot.hand;
            player.huddleReady = replaceableBot.huddleReady;
            room.teams[replaceableBot.teamIndex].seats[replaceableBot.seatIndex] = player.id;
            room.players.delete(replaceableBot.id);
            room.players.set(player.id, player);
          } else {
            player = createPlayerRecord({ name: msg.name, token: msg.token });
            room.players.set(player.id, player);
          }
        } else {
          player = createPlayerRecord({ name: msg.name, token: msg.token });
          addPlayerToRoom(room, player);
        }
      }

      if (!room.hostId && !player.isBot) {
        room.hostId = player.id;
      }

      attachSocketToPlayer(ws, room, player);
      sendJson(ws, {
        type: 'joined',
        roomCode: room.code,
        playerId: player.id,
        token: player.token,
      });
      broadcastRoom(room);
      return;
    }

    if (type === 'leave_room') {
      const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
      const pid = ws.playerId;
      detachSocket(ws);
      if (room && pid) {
        if (room.phase === 'lobby') {
          removePlayerFromRoom(room, pid);
        }
        broadcastRoom(room);
      }
      sendJson(ws, { type: 'left_room' });
      return;
    }

    // All remaining actions require an active room & player
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    const playerId = ws.playerId;
    if (!room || !playerId || !room.players.has(playerId)) {
      sendJson(ws, { type: 'error', message: 'You are not currently seated at an active room.' });
      return;
    }

    switch (type) {
      case 'select_seat': {
        const res = seatPlayer(room, playerId, Number(msg.teamIndex), Number(msg.seatIndex));
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room);
        break;
      }

      case 'add_bot': {
        if (playerId !== room.hostId) {
          return sendJson(ws, { type: 'toast', kind: 'warn', message: 'Only the host can add bots.' });
        }
        const res = addBotToSeat(room, Number(msg.teamIndex), Number(msg.seatIndex));
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room);
        break;
      }

      case 'fill_bots': {
        if (playerId !== room.hostId) {
          return sendJson(ws, { type: 'toast', kind: 'warn', message: 'Only the host can manage bots.' });
        }
        const res = fillEmptySeatsWithBots(room);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room);
        break;
      }

      case 'remove_player': {
        if (playerId !== room.hostId) {
          return sendJson(ws, { type: 'toast', kind: 'warn', message: 'Only the host can remove seats.' });
        }
        if (msg.targetId === playerId) return;
        const target = room.players.get(msg.targetId);
        if (!target) return;
        removePlayerFromRoom(room, msg.targetId);
        broadcastRoom(room);
        break;
      }

      case 'update_settings': {
        const res = updateRoomSettings(room, playerId, msg.settings || {});
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room);
        break;
      }

      case 'start_match': {
        const res = startMatch(room, playerId);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room, { kind: 'match_started' });
        break;
      }

      case 'huddle_message': {
        const res = sendHuddleMessage(room, playerId, msg.text);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room);
        break;
      }

      case 'huddle_signal': {
        const res = setTeamSignalNote(room, playerId, msg.signalNote);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room);
        break;
      }

      case 'huddle_ready': {
        const res = toggleHuddleReady(room, playerId);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room, res.dealt ? { kind: 'cards_dealt' } : null);
        break;
      }

      case 'swap_card': {
        const res = swapCard(
          room,
          playerId,
          msg.handCardId,
          msg.centerIndex,
          msg.expectedCenterCardId
        );
        if (!res.ok) {
          sendJson(ws, {
            type: 'swap_rejected',
            code: res.code,
            message: res.message,
          });
          return;
        }
        broadcastRoom(room, {
          kind: 'card_swapped',
          playerId,
          centerIndex: Number(msg.centerIndex),
        });
        break;
      }

      case 'toggle_flush': {
        const res = toggleFlushVote(room, playerId);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room, res.flushed ? { kind: 'center_flushed' } : null);
        break;
      }

      case 'table_tell': {
        const res = triggerTableTell(room, playerId, msg.tellKey);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room, { kind: 'table_tell', playerId, tellKey: msg.tellKey });
        break;
      }

      case 'call_kemp': {
        const res = callKemp(room, playerId);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room, {
          kind: 'showdown',
          callType: 'kemp',
          success: res.outcome.success,
        });
        break;
      }

      case 'call_not_kemp': {
        const res = callNotKemp(room, playerId, msg.targetPlayerId || null);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        if (res.awaitingTarget) {
          broadcastRoom(room, { kind: 'freeze_not_kemp', callerId: playerId });
        } else {
          broadcastRoom(room, {
            kind: 'showdown',
            callType: 'not_kemp',
            success: res.outcome.success,
          });
        }
        break;
      }

      case 'next_round': {
        if (room.phase !== 'round_over') return;
        const player = room.players.get(playerId);
        if (player) player.nextRoundReady = true;

        // Either host triggers immediately or all active humans ready up
        const activeHumans = [...room.players.values()].filter(
          (p) =>
            !p.isBot &&
            p.connected &&
            p.teamIndex !== null &&
            p.teamIndex < room.settings.numTeams &&
            !room.teams[p.teamIndex]?.eliminated
        );
        const allHumansReady = activeHumans.every((p) => p.nextRoundReady);

        if (playerId === room.hostId || allHumansReady) {
          startRoundHuddle(room);
          broadcastRoom(room, { kind: 'huddle_started' });
        } else {
          broadcastRoom(room);
        }
        break;
      }

      case 'return_lobby': {
        const res = returnToLobby(room, playerId);
        if (!res.ok) return sendJson(ws, { type: 'toast', kind: 'warn', message: res.message });
        broadcastRoom(room, { kind: 'returned_lobby' });
        break;
      }

      default:
        sendJson(ws, { type: 'error', message: `Unknown action: ${type}` });
    }
  }

  // Game loop tick (countdown transitions, huddle timers, accusation shot clock, AI bots)
  const gameTickInterval = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      // Garbage collect stale rooms with no connected humans for > 2 hours
      const hasConnectedHuman = [...room.players.values()].some((p) => !p.isBot && p.connected);
      if (!hasConnectedHuman && now - room.updatedAt > 2 * 60 * 60 * 1000) {
        rooms.delete(code);
        continue;
      }

      if (room.phase === 'huddle' && room.huddleEndsAt > 0 && now >= room.huddleEndsAt) {
        beginCountdownAndDeal(room);
        broadcastRoom(room, { kind: 'cards_dealt' });
        continue;
      }

      if (finishCountdownIfReady(room)) {
        broadcastRoom(room, { kind: 'round_live' });
        continue;
      }

      if (resolveExpiredAccusationIfNeeded(room)) {
        broadcastRoom(room, {
          kind: 'showdown',
          callType: 'not_kemp',
          success: Boolean(room.roundSummary?.success),
        });
        continue;
      }

      if (room.phase === 'playing') {
        const prevPhase = room.phase;
        const botMutated = tickRoomBots(room);
        if (botMutated) {
          const event =
            room.phase !== prevPhase && room.roundSummary
              ? {
                  kind: 'showdown',
                  callType: room.roundSummary.callType,
                  success: room.roundSummary.success,
                }
              : null;
          broadcastRoom(room, event);
        }
      }
    }
  }, 250);

  // Cloud Run WebSocket keep-alive ping every 25s
  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(gameTickInterval);
    clearInterval(pingInterval);
  });

  return { app, server, wss, rooms };
}

// Start server when invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 8080);
  const { server } = createKempServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`Kemp Online server listening on http://0.0.0.0:${port}`);
  });
}
