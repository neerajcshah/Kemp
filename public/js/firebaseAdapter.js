/**
 * Serverless Google Firebase Spark Plan ($0, no credit card required) multiplayer adapter.
 * Uses Firebase Anonymous Auth + Firebase Realtime Database atomic transactions (runTransaction)
 * so simultaneous center-card grabs, secret partner huddles, AI bots, and KEMP / NOT KEMP calls
 * work identically to the Cloud Run WebSocket server at zero cost.
 */

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
const KEMP_LETTERS = ['K', 'E', 'M', 'P'];
const RANK_ORDER = Object.fromEntries(RANKS.map((r, i) => [r, i]));
const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };

const TEAM_CONFIGS = [
  { index: 0, name: 'Emerald', accent: 'emerald' },
  { index: 1, name: 'Vermilion', accent: 'vermilion' },
  { index: 2, name: 'Ochre', accent: 'ochre' },
  { index: 3, name: 'Cobalt', accent: 'cobalt' },
];

export const TABLE_TELLS = {
  tap: { key: 'tap', label: 'Tapped the table', icon: 'touch_app' },
  adjust: { key: 'adjust', label: 'Squared their cards', icon: 'style' },
  throat: { key: 'throat', label: 'Cleared throat', icon: 'graphic_eq' },
  glance: { key: 'glance', label: 'Glanced across', icon: 'visibility' },
  chin: { key: 'chin', label: 'Rested chin on hand', icon: 'front_hand' },
  sip: { key: 'sip', label: 'Took a slow sip', icon: 'local_cafe' },
};

export const SIGNAL_SUGGESTIONS = [
  'Scratch left ear subtly on camera',
  'Say "Anyone want these?" before swapping',
  'Adjust glasses / hair = Kemp, cough = decoy',
  'Rest chin on hand while looking at Meet',
  'Nod twice after picking up a card',
  'Say a number in casual conversation',
];

const BOT_NAMES = [
  'Arthur (Bot)',
  'Celeste (Bot)',
  'Mateo (Bot)',
  'Nadia (Bot)',
  'Gideon (Bot)',
  'Camille (Bot)',
  'Julian (Bot)',
  'Sora (Bot)',
];

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeShuffledDeck() {
  const d = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      d.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return shuffle(d);
}

function sortHand(hand) {
  return [...(hand || [])].sort((a, b) => {
    const rd = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    return rd !== 0 ? rd : SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  });
}

function evalQuad(hand) {
  if (!Array.isArray(hand) || hand.length !== 4) return { match: false, rank: null };
  const r = hand[0].rank;
  const ok = hand.every((c) => c && c.rank === r);
  return { match: ok, rank: ok ? r : null };
}

function formatRankPlural(rank) {
  const names = { A: 'Aces', K: 'Kings', Q: 'Queens', J: 'Jacks' };
  return names[rank] || `${rank}s`;
}

function sanitizeMeetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withProto);
    const host = parsed.hostname.toLowerCase();
    if (host === 'meet.google.com' || host === 'meet.new' || host.endsWith('.google.com')) {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += chars[randInt(chars.length)];
  return out;
}

export async function createFirebaseTransport(firebaseConfig, onEvent) {
  const [
    { initializeApp },
    { getAuth, signInAnonymously },
    { getDatabase, ref, get, set, onValue, runTransaction, onDisconnect },
  ] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js'),
  ]);

  if (!firebaseConfig.databaseURL && firebaseConfig.projectId) {
    firebaseConfig.databaseURL = `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com`;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const cred = await signInAnonymously(auth);

  // Per-tab player ID derived from session token so multiple tabs on one computer still work independently
  let tabId = sessionStorage.getItem('kemp_fb_tab_id');
  if (!tabId) {
    tabId = `${cred.user.uid.slice(0, 10)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('kemp_fb_tab_id', tabId);
  }

  const db = getDatabase(app);
  let activeRoomCode = null;
  let unsubscribeRoom = null;
  let latestRawRoom = null;

  setTimeout(() => {
    onEvent({
      type: 'welcome',
      tells: Object.values(TABLE_TELLS),
      signalSuggestions: SIGNAL_SUGGESTIONS,
    });
  }, 0);

  function subscribeToRoom(code) {
    if (unsubscribeRoom) {
      unsubscribeRoom();
      unsubscribeRoom = null;
    }
    activeRoomCode = code;
    const roomRef = ref(db, `rooms/${code}`);

    // Mark disconnected cleanly if browser closes
    const connRef = ref(db, `rooms/${code}/players/${tabId}/connected`);
    onDisconnect(connRef).set(false).catch(() => {});

    let lastActionTs = 0;
    unsubscribeRoom = onValue(roomRef, (snap) => {
      const room = snap.val();
      if (!room) {
        latestRawRoom = null;
        return;
      }
      latestRawRoom = normalizeRoom(room);
      let evt = null;
      if (latestRawRoom.lastAction && latestRawRoom.lastAction.timestamp > lastActionTs) {
        lastActionTs = latestRawRoom.lastAction.timestamp;
        evt = latestRawRoom.lastAction.event || null;
      }
      const projected = projectRoomForViewer(latestRawRoom, tabId);
      onEvent({ type: 'room_state', state: projected, event: evt });
    });
  }

  async function mutateRoom(code, mutator) {
    const roomRef = ref(db, `rooms/${code}`);
    let sideResult = { ok: true };
    await runTransaction(roomRef, (current) => {
      if (!current) return current;
      const room = normalizeRoom(current);
      const res = mutator(room);
      if (res && res.ok === false) {
        sideResult = res;
        return; // Abort transaction cleanly
      }
      sideResult = res || { ok: true };
      room.updatedAt = Date.now();
      return room;
    });
    return sideResult;
  }

  // Host ticker for countdowns, shot clocks, and AI bots
  const hostInterval = setInterval(async () => {
    if (!activeRoomCode || !latestRawRoom) return;
    if (latestRawRoom.hostId !== tabId) return;

    const now = Date.now();
    const r = latestRawRoom;

    if (r.phase === 'huddle' && r.huddleEndsAt > 0 && now >= r.huddleEndsAt) {
      await mutateRoom(activeRoomCode, (rm) => {
        if (rm.phase === 'huddle') dealCardsOnRoom(rm, 2200);
      });
      return;
    }

    if (r.phase === 'countdown' && now >= r.countdownEndsAt) {
      await mutateRoom(activeRoomCode, (rm) => {
        if (rm.phase === 'countdown' && Date.now() >= rm.countdownEndsAt) {
          rm.phase = 'playing';
          rm.countdownEndsAt = 0;
          rm.lastFlushAt = Date.now();
          rm.lastAction = { timestamp: Date.now(), event: { kind: 'round_live' } };
        }
      });
      return;
    }

    if (r.phase === 'accusing' && r.accusation && now >= r.accusation.expiresAt) {
      await mutateRoom(activeRoomCode, (rm) => {
        if (rm.phase !== 'accusing' || !rm.accusation) return;
        const opps = getActivePlayers(rm).filter((p) => p.teamIndex !== rm.accusation.callerTeam);
        if (opps.length > 0) {
          executeNotKemp(rm, rm.accusation.callerId, opps[randInt(opps.length)].id);
        }
      });
      return;
    }

    if (r.phase === 'playing') {
      const hasBots = getActivePlayers(r).some((p) => p.isBot);
      if (hasBots && Math.random() < 0.45) {
        await mutateRoom(activeRoomCode, (rm) => runBotsStep(rm));
      }
    }
  }, 450);

  return {
    destroy() {
      clearInterval(hostInterval);
      if (unsubscribeRoom) unsubscribeRoom();
    },

    async send(msg) {
      const { type } = msg || {};

      if (type === 'create_room') {
        let code = genCode();
        for (let tries = 0; tries < 8; tries++) {
          const snap = await get(ref(db, `rooms/${code}`));
          if (!snap.exists()) break;
          code = genCode();
        }
        const host = makePlayer(tabId, msg.name, false);
        const room = makeFreshRoom(code, host);
        if (msg.quickDemo) {
          fillBotsOnRoom(room);
          startMatchOnRoom(room, tabId);
        }
        await set(ref(db, `rooms/${code}`), room);
        subscribeToRoom(code);
        onEvent({ type: 'joined', roomCode: code, playerId: tabId, token: tabId });
        return;
      }

      if (type === 'join_room') {
        const code = String(msg.code || '').trim().toUpperCase();
        const snap = await get(ref(db, `rooms/${code}`));
        if (!snap.exists()) {
          onEvent({
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            message: `Room "${code || '----'}" was not found.`,
          });
          return;
        }
        await mutateRoom(code, (rm) => {
          let p = rm.players[tabId];
          if (p) {
            p.connected = true;
            if (msg.name) p.name = cleanName(msg.name);
          } else {
            p = makePlayer(tabId, msg.name, false);
            rm.players[tabId] = p;
            if (rm.phase === 'lobby') {
              autoSeat(rm, tabId);
            } else {
              const bot = Object.values(rm.players).find((x) => x.isBot && x.teamIndex !== null);
              if (bot) {
                p.teamIndex = bot.teamIndex;
                p.seatIndex = bot.seatIndex;
                p.hand = bot.hand || [];
                p.huddleReady = bot.huddleReady;
                rm.teams[bot.teamIndex].seats[bot.seatIndex] = tabId;
                delete rm.players[bot.id];
              }
            }
          }
          if (!rm.hostId || !rm.players[rm.hostId]?.connected) {
            rm.hostId = tabId;
          }
        });
        subscribeToRoom(code);
        onEvent({ type: 'joined', roomCode: code, playerId: tabId, token: tabId });
        return;
      }

      if (type === 'leave_room') {
        const code = activeRoomCode;
        if (unsubscribeRoom) {
          unsubscribeRoom();
          unsubscribeRoom = null;
        }
        activeRoomCode = null;
        if (code) {
          await mutateRoom(code, (rm) => {
            const p = rm.players[tabId];
            if (!p) return;
            if (rm.phase === 'lobby') {
              if (p.teamIndex !== null && p.seatIndex !== null) {
                if (rm.teams[p.teamIndex]?.seats[p.seatIndex] === tabId) {
                  rm.teams[p.teamIndex].seats[p.seatIndex] = '';
                }
              }
              delete rm.players[tabId];
            } else {
              p.connected = false;
            }
            if (rm.hostId === tabId) {
              const next = Object.values(rm.players).find((x) => !x.isBot && x.connected);
              rm.hostId = next ? next.id : '';
            }
          });
        }
        onEvent({ type: 'left_room' });
        return;
      }

      if (!activeRoomCode) return;

      const res = await mutateRoom(activeRoomCode, (rm) => {
        switch (type) {
          case 'select_seat':
            return seatOnRoom(rm, tabId, Number(msg.teamIndex), Number(msg.seatIndex));
          case 'add_bot':
            if (rm.hostId !== tabId) return { ok: false, message: 'Only host can add bots.' };
            return addBotOnRoom(rm, Number(msg.teamIndex), Number(msg.seatIndex));
          case 'fill_bots':
            if (rm.hostId !== tabId) return { ok: false, message: 'Only host can fill bots.' };
            return fillBotsOnRoom(rm);
          case 'remove_player': {
            if (rm.hostId !== tabId) return { ok: false, message: 'Only host can remove players.' };
            const tgt = rm.players[msg.targetId];
            if (tgt && tgt.id !== tabId) {
              if (tgt.teamIndex !== null && rm.teams[tgt.teamIndex]?.seats[tgt.seatIndex] === tgt.id) {
                rm.teams[tgt.teamIndex].seats[tgt.seatIndex] = '';
              }
              delete rm.players[tgt.id];
            }
            return { ok: true };
          }
          case 'update_settings':
            return updateSettingsOnRoom(rm, tabId, msg.settings || {});
          case 'start_match':
            return startMatchOnRoom(rm, tabId);
          case 'huddle_message':
            return addHuddleMsg(rm, tabId, msg.text);
          case 'huddle_signal':
            return setSignalOnRoom(rm, tabId, msg.signalNote);
          case 'huddle_ready':
            return toggleReadyOnRoom(rm, tabId);
          case 'swap_card':
            return swapCardOnRoom(rm, tabId, msg.handCardId, Number(msg.centerIndex), msg.expectedCenterCardId);
          case 'toggle_flush':
            return toggleFlushOnRoom(rm, tabId);
          case 'table_tell':
            return sendTellOnRoom(rm, tabId, msg.tellKey);
          case 'call_kemp':
            return executeKemp(rm, tabId);
          case 'call_not_kemp':
            return executeNotKemp(rm, tabId, msg.targetPlayerId || null);
          case 'next_round': {
            if (rm.phase !== 'round_over') return { ok: true };
            if (rm.players[tabId]) rm.players[tabId].nextRoundReady = true;
            const humans = getActivePlayers(rm).filter((p) => !p.isBot && p.connected);
            if (tabId === rm.hostId || humans.every((p) => p.nextRoundReady)) {
              enterHuddleOnRoom(rm);
            }
            return { ok: true };
          }
          case 'return_lobby': {
            if (tabId !== rm.hostId) return { ok: false, message: 'Only host can return to lobby.' };
            rm.phase = 'lobby';
            rm.roundNumber = 0;
            rm.centerCards = [];
            rm.roundSummary = null;
            rm.matchWinnerTeam = null;
            rm.teams.forEach((t) => {
              t.letters = 0;
              t.eliminated = false;
            });
            Object.values(rm.players).forEach((p) => {
              p.hand = [];
              p.huddleReady = false;
            });
            return { ok: true };
          }
          default:
            return { ok: true };
        }
      });

      if (res && res.ok === false) {
        if (res.code === 'RACE_LOST') {
          onEvent({ type: 'swap_rejected', code: res.code, message: res.message });
        } else if (res.message) {
          onEvent({ type: 'toast', kind: 'warn', message: res.message });
        }
      }
    },
  };
}

// --- Pure Firebase Room State Helpers ---

function cleanName(n, isBot = false) {
  const s = String(n || '').trim().slice(0, 22);
  return s || (isBot ? 'Card Bot' : 'Player');
}

function makePlayer(id, name, isBot) {
  return {
    id,
    name: cleanName(name, isBot),
    isBot: Boolean(isBot),
    connected: true,
    teamIndex: null,
    seatIndex: null,
    hand: [],
    huddleReady: false,
    nextRoundReady: false,
    lastSwapAt: 0,
  };
}

function makeFreshRoom(code, host) {
  const room = {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hostId: host.id,
    phase: 'lobby',
    roundNumber: 0,
    settings: {
      numTeams: 2,
      notKempMode: 'specific',
      kempScoringMode: 'earn',
      huddleSeconds: 0,
      meetUrl: '',
    },
    teams: TEAM_CONFIGS.map((c) => ({
      index: c.index,
      name: c.name,
      accent: c.accent,
      letters: 0,
      eliminated: false,
      seats: ['', ''],
    })),
    players: { [host.id]: host },
    teamHuddles: {},
    deck: [],
    discardPile: [],
    centerCards: [],
    flushVotes: {},
    flushCount: 0,
    lastFlushAt: 0,
    countdownEndsAt: 0,
    huddleEndsAt: 0,
    accusation: null,
    lastAction: null,
    activeTells: {},
    roundSummary: null,
    matchWinnerTeam: null,
  };
  seatOnRoom(room, host.id, 0, 0);
  return room;
}

function normalizeRoom(raw) {
  // Firebase strips empty arrays/objects on storage; restore defaults safely
  const rm = { ...raw };
  rm.players = rm.players || {};
  Object.values(rm.players).forEach((p) => {
    p.hand = p.hand || [];
    if (p.teamIndex === undefined) p.teamIndex = null;
    if (p.seatIndex === undefined) p.seatIndex = null;
  });
  rm.teams = (rm.teams || TEAM_CONFIGS).map((t, idx) => ({
    index: idx,
    name: t.name || TEAM_CONFIGS[idx].name,
    accent: t.accent || TEAM_CONFIGS[idx].accent,
    letters: t.letters || 0,
    eliminated: Boolean(t.eliminated),
    seats: [t.seats?.[0] || '', t.seats?.[1] || ''],
  }));
  rm.teamHuddles = rm.teamHuddles || {};
  rm.deck = rm.deck || [];
  rm.discardPile = rm.discardPile || [];
  rm.centerCards = rm.centerCards || [];
  rm.flushVotes = rm.flushVotes || {};
  rm.activeTells = rm.activeTells || {};
  if (rm.matchWinnerTeam === undefined) rm.matchWinnerTeam = null;
  return rm;
}

function autoSeat(rm, pid) {
  for (let t = 0; t < rm.settings.numTeams; t++) {
    for (let s = 0; s < 2; s++) {
      if (!rm.teams[t].seats[s]) {
        return seatOnRoom(rm, pid, t, s);
      }
    }
  }
  return { ok: true };
}

function seatOnRoom(rm, pid, tIdx, sIdx) {
  if (rm.phase !== 'lobby') return { ok: false, message: 'Seats locked outside lobby.' };
  if (tIdx < 0 || tIdx >= rm.settings.numTeams || (sIdx !== 0 && sIdx !== 1)) {
    return { ok: false, message: 'Invalid seat.' };
  }
  if (rm.teams[tIdx].seats[sIdx] && rm.teams[tIdx].seats[sIdx] !== pid) {
    return { ok: false, message: 'Seat already taken.' };
  }
  const p = rm.players[pid];
  if (!p) return { ok: false };
  if (p.teamIndex !== null && p.seatIndex !== null && rm.teams[p.teamIndex]?.seats[p.seatIndex] === pid) {
    rm.teams[p.teamIndex].seats[p.seatIndex] = '';
  }
  rm.teams[tIdx].seats[sIdx] = pid;
  p.teamIndex = tIdx;
  p.seatIndex = sIdx;
  return { ok: true };
}

function addBotOnRoom(rm, tIdx, sIdx) {
  if (rm.teams[tIdx]?.seats[sIdx]) return { ok: false, message: 'Seat occupied.' };
  const used = new Set(Object.values(rm.players).map((p) => p.name));
  const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${Object.keys(rm.players).length}`;
  const id = `bot_${Date.now()}_${randInt(9999)}`;
  rm.players[id] = makePlayer(id, name, true);
  return seatOnRoom(rm, id, tIdx, sIdx);
}

function fillBotsOnRoom(rm) {
  for (let t = 0; t < rm.settings.numTeams; t++) {
    for (let s = 0; s < 2; s++) {
      if (!rm.teams[t].seats[s]) addBotOnRoom(rm, t, s);
    }
  }
  return { ok: true };
}

function updateSettingsOnRoom(rm, actorId, patch) {
  if (actorId !== rm.hostId) return { ok: false, message: 'Only host can change settings.' };
  if (patch.meetUrl !== undefined) {
    const cleaned = sanitizeMeetUrl(patch.meetUrl);
    if (patch.meetUrl.trim() !== '' && !cleaned) {
      return { ok: false, message: 'Enter a valid meet.google.com link.' };
    }
    rm.settings.meetUrl = cleaned;
  }
  if (rm.phase !== 'lobby') return { ok: true };
  if ([2, 3, 4].includes(Number(patch.numTeams))) {
    const n = Number(patch.numTeams);
    for (let t = n; t < 4; t++) {
      for (let s = 0; s < 2; s++) {
        const pid = rm.teams[t].seats[s];
        rm.teams[t].seats[s] = '';
        if (pid && rm.players[pid]) {
          if (rm.players[pid].isBot) delete rm.players[pid];
          else {
            rm.players[pid].teamIndex = null;
            rm.players[pid].seatIndex = null;
          }
        }
      }
    }
    rm.settings.numTeams = n;
  }
  if (patch.notKempMode === 'specific' || patch.notKempMode === 'any') rm.settings.notKempMode = patch.notKempMode;
  if (patch.kempScoringMode === 'earn' || patch.kempScoringMode === 'penalty') rm.settings.kempScoringMode = patch.kempScoringMode;
  if ([0, 30, 45, 60].includes(Number(patch.huddleSeconds))) rm.settings.huddleSeconds = Number(patch.huddleSeconds);
  return { ok: true };
}

function getActiveTeams(rm) {
  return rm.teams.slice(0, rm.settings.numTeams).filter((t) => !t.eliminated);
}

function getActivePlayers(rm) {
  const list = [];
  for (const t of getActiveTeams(rm)) {
    for (const pid of t.seats) {
      if (pid && rm.players[pid]) list.push(rm.players[pid]);
    }
  }
  return list;
}

function getPartner(rm, pid) {
  const p = rm.players[pid];
  if (!p || p.teamIndex === null) return null;
  const otherId = rm.teams[p.teamIndex]?.seats[p.seatIndex === 0 ? 1 : 0];
  return otherId ? rm.players[otherId] || null : null;
}

function startMatchOnRoom(rm, actorId) {
  if (actorId !== rm.hostId) return { ok: false, message: 'Only host can start.' };
  for (let t = 0; t < rm.settings.numTeams; t++) {
    if (!rm.teams[t].seats[0] || !rm.teams[t].seats[1]) {
      return { ok: false, message: 'Fill every team seat or add bots before starting.' };
    }
  }
  rm.roundNumber = 0;
  rm.matchWinnerTeam = null;
  rm.teams.forEach((t) => {
    t.letters = 0;
    t.eliminated = false;
  });
  return enterHuddleOnRoom(rm);
}

function enterHuddleOnRoom(rm) {
  rm.roundNumber += 1;
  rm.phase = 'huddle';
  rm.centerCards = [];
  rm.flushVotes = {};
  rm.activeTells = {};
  rm.accusation = null;
  rm.roundSummary = null;
  rm.huddleEndsAt = rm.settings.huddleSeconds > 0 ? Date.now() + rm.settings.huddleSeconds * 1000 : 0;

  const tellKeys = Object.keys(TABLE_TELLS);
  for (const t of getActiveTeams(rm)) {
    const prev = rm.teamHuddles[t.index];
    const botKey = tellKeys[randInt(tellKeys.length)];
    const tellInfo = TABLE_TELLS[botKey];
    const p0 = rm.players[t.seats[0]];
    const p1 = rm.players[t.seats[1]];
    const botP = p0?.isBot ? p0 : p1?.isBot ? p1 : null;
    const hasHuman = Boolean((p0 && !p0.isBot) || (p1 && !p1.isBot));

    const messages = [];
    let signalNote = prev?.signalNote || '';
    if (botP) {
      signalNote = `${tellInfo.label} = 4-of-a-kind`;
      if (hasHuman) {
        messages.push({
          id: `m_${Date.now()}`,
          senderId: botP.id,
          senderName: botP.name,
          text: `Round ${rm.roundNumber} plan: Watch me — I will "${tellInfo.label}" when I get 4-of-a-kind! Click ★ "${tellInfo.label}" if YOU get 4-of-a-kind and I'll yell KEMP!`,
          timestamp: Date.now(),
        });
      }
    }
    rm.teamHuddles[t.index] = { messages, signalNote, botTellKey: botKey };
  }

  Object.values(rm.players).forEach((p) => {
    p.hand = [];
    p.nextRoundReady = false;
    const active = p.teamIndex !== null && p.teamIndex < rm.settings.numTeams && !rm.teams[p.teamIndex]?.eliminated;
    p.huddleReady = Boolean(active && p.isBot);
  });

  if (getActivePlayers(rm).every((p) => p.huddleReady)) {
    dealCardsOnRoom(rm, 2200);
  }
  rm.lastAction = { timestamp: Date.now(), event: { kind: 'huddle_started' } };
  return { ok: true };
}

function addHuddleMsg(rm, pid, text) {
  if (rm.phase !== 'huddle') return { ok: false, message: 'Huddle chat is locked during live play!' };
  const p = rm.players[pid];
  if (!p || p.teamIndex === null) return { ok: false };
  const clean = String(text || '').trim().slice(0, 200);
  if (!clean) return { ok: false };
  const hud = rm.teamHuddles[p.teamIndex] || { messages: [], signalNote: '' };
  hud.messages = hud.messages || [];
  hud.messages.push({
    id: `m_${Date.now()}_${randInt(999)}`,
    senderId: pid,
    senderName: p.name,
    text: clean,
    timestamp: Date.now(),
  });
  rm.teamHuddles[p.teamIndex] = hud;
  return { ok: true };
}

function setSignalOnRoom(rm, pid, note) {
  if (rm.phase !== 'huddle') return { ok: false, message: 'Locked during round.' };
  const p = rm.players[pid];
  if (!p || p.teamIndex === null) return { ok: false };
  const hud = rm.teamHuddles[p.teamIndex] || { messages: [], signalNote: '' };
  hud.signalNote = String(note || '').trim().slice(0, 90);
  rm.teamHuddles[p.teamIndex] = hud;
  return { ok: true };
}

function toggleReadyOnRoom(rm, pid) {
  if (rm.phase !== 'huddle') return { ok: false };
  const p = rm.players[pid];
  if (!p || p.teamIndex === null) return { ok: false };
  p.huddleReady = !p.huddleReady;
  if (getActivePlayers(rm).every((x) => x.huddleReady)) {
    dealCardsOnRoom(rm, 2200);
  }
  return { ok: true };
}

function dealCardsOnRoom(rm, countdownMs = 2200) {
  const act = getActivePlayers(rm);
  let deck = makeShuffledDeck();
  for (let attempt = 0; attempt < 10; attempt++) {
    deck = makeShuffledDeck();
    if (!act.some((_, i) => evalQuad(deck.slice(i * 4, i * 4 + 4)).match)) break;
  }
  act.forEach((p) => {
    p.hand = sortHand(deck.splice(0, 4));
    p.lastSwapAt = 0;
  });
  rm.centerCards = deck.splice(0, 4);
  rm.deck = deck;
  rm.discardPile = [];
  rm.flushVotes = {};
  rm.flushCount = 0;
  rm.lastFlushAt = Date.now();
  rm.activeTells = {};
  rm.huddleEndsAt = 0;
  rm.phase = countdownMs > 0 ? 'countdown' : 'playing';
  rm.countdownEndsAt = countdownMs > 0 ? Date.now() + countdownMs : 0;
  rm.lastAction = { timestamp: Date.now(), event: { kind: 'cards_dealt' } };
}

function swapCardOnRoom(rm, pid, handCardId, cIdx, expectedCenterId) {
  if (rm.phase !== 'playing') return { ok: false, message: 'Round is not live.' };
  const p = rm.players[pid];
  if (!p || p.teamIndex === null || rm.teams[p.teamIndex]?.eliminated) return { ok: false };
  const cCard = rm.centerCards[cIdx];
  if (!cCard) return { ok: false };
  if (expectedCenterId && cCard.id !== expectedCenterId) {
    return { ok: false, code: 'RACE_LOST', message: 'Snatched! Someone grabbed that card a split-second earlier.' };
  }
  const hIdx = p.hand.findIndex((c) => c.id === handCardId);
  if (hIdx === -1) return { ok: false };

  const discarded = p.hand[hIdx];
  p.hand[hIdx] = cCard;
  rm.centerCards[cIdx] = discarded;
  p.lastSwapAt = Date.now();
  rm.flushVotes = {};
  rm.lastAction = {
    timestamp: Date.now(),
    event: { kind: 'card_swapped', playerId: pid, centerIndex: cIdx },
  };
  return { ok: true };
}

function toggleFlushOnRoom(rm, pid) {
  if (rm.phase !== 'playing') return { ok: false };
  if (rm.flushVotes[pid]) {
    delete rm.flushVotes[pid];
    return { ok: true };
  }
  rm.flushVotes[pid] = true;
  const act = getActivePlayers(rm);
  if (act.every((p) => rm.flushVotes[p.id])) {
    rm.discardPile.push(...rm.centerCards);
    rm.centerCards = [];
    rm.flushVotes = {};
    if (rm.deck.length < 4 && rm.discardPile.length > 0) {
      rm.deck.push(...shuffle(rm.discardPile));
      rm.discardPile = [];
    }
    rm.centerCards = rm.deck.splice(0, Math.min(4, rm.deck.length));
    rm.flushCount += 1;
    rm.lastFlushAt = Date.now();
    rm.lastAction = { timestamp: Date.now(), event: { kind: 'center_flushed' } };
  }
  return { ok: true };
}

function sendTellOnRoom(rm, pid, tellKey) {
  if (rm.phase !== 'playing') return { ok: false };
  const p = rm.players[pid];
  const tell = TABLE_TELLS[tellKey];
  if (!p || !tell) return { ok: false };
  rm.activeTells[pid] = {
    playerId: pid,
    playerName: p.name,
    teamIndex: p.teamIndex,
    tellKey: tell.key,
    label: tell.label,
    icon: tell.icon,
    timestamp: Date.now(),
    expiresAt: Date.now() + 2800,
  };
  return { ok: true };
}

function executeKemp(rm, callerId) {
  if (rm.phase !== 'playing') return { ok: false };
  const caller = rm.players[callerId];
  const partner = getPartner(rm, callerId);
  if (!caller || !partner) return { ok: false };
  const check = evalQuad(partner.hand);
  if (check.match) {
    scoreRound(rm, {
      winTeam: caller.teamIndex,
      caughtTeams: null,
      success: true,
      callType: 'kemp',
      headline: `KEMP! ${caller.name} read ${partner.name}'s signal!`,
      detail: `${partner.name} held four ${formatRankPlural(check.rank)}.`,
    });
  } else {
    scoreRound(rm, {
      faultTeam: caller.teamIndex,
      beneficiaryTeam: null,
      success: false,
      callType: 'kemp',
      headline: `FALSE KEMP! ${caller.name} jumped the gun!`,
      detail: `${partner.name} did not hold four-of-a-kind.`,
    });
  }
  return { ok: true };
}

function executeNotKemp(rm, callerId, targetId = null) {
  const caller = rm.players[callerId];
  if (!caller) return { ok: false };

  if (rm.settings.notKempMode === 'any') {
    if (rm.phase !== 'playing') return { ok: false };
    const caught = getActivePlayers(rm)
      .filter((p) => p.teamIndex !== caller.teamIndex)
      .map((p) => ({ p, q: evalQuad(p.hand) }))
      .filter((x) => x.q.match);

    if (caught.length > 0) {
      scoreRound(rm, {
        winTeam: caller.teamIndex,
        caughtTeams: [...new Set(caught.map((x) => x.p.teamIndex))],
        success: true,
        callType: 'not_kemp',
        headline: `NOT KEMP! ${caller.name} intercepted the signal!`,
        detail: `Caught ${caught[0].p.name} holding four ${formatRankPlural(caught[0].q.rank)}!`,
      });
    } else {
      scoreRound(rm, {
        faultTeam: caller.teamIndex,
        beneficiaryTeam: null,
        success: false,
        callType: 'not_kemp',
        headline: `FALSE NOT KEMP! Nobody had four-of-a-kind!`,
        detail: `${caller.name} called Not Kemp, but every opponent came up clean.`,
      });
    }
    return { ok: true };
  }

  if (!targetId) {
    if (rm.phase !== 'playing') return { ok: false };
    rm.phase = 'accusing';
    rm.accusation = {
      callerId: caller.id,
      callerName: caller.name,
      callerTeam: caller.teamIndex,
      expiresAt: Date.now() + 8000,
    };
    rm.lastAction = { timestamp: Date.now(), event: { kind: 'freeze_not_kemp', callerId } };
    return { ok: true };
  }

  const target = rm.players[targetId];
  if (!target || target.teamIndex === caller.teamIndex) return { ok: false };
  const check = evalQuad(target.hand);
  rm.accusation = null;

  if (check.match) {
    scoreRound(rm, {
      winTeam: caller.teamIndex,
      caughtTeams: [target.teamIndex],
      success: true,
      callType: 'not_kemp',
      headline: `NOT KEMP! ${caller.name} caught ${target.name} red-handed!`,
      detail: `${target.name} held four ${formatRankPlural(check.rank)}!`,
    });
  } else {
    scoreRound(rm, {
      faultTeam: caller.teamIndex,
      beneficiaryTeam: target.teamIndex,
      success: false,
      callType: 'not_kemp',
      headline: `WRONG CALL! ${target.name} was bluffing!`,
      detail: `${caller.name} accused ${target.name}, who did not hold four-of-a-kind.`,
    });
  }
  return { ok: true };
}

function scoreRound(rm, info) {
  const letterChanges = [];
  const activeTeams = getActiveTeams(rm);

  if (rm.settings.kempScoringMode === 'earn') {
    if (info.success) {
      const tm = rm.teams[info.winTeam];
      const ltr = KEMP_LETTERS[tm.letters] || 'P';
      tm.letters = Math.min(4, tm.letters + 1);
      letterChanges.push({
        teamIndex: tm.index,
        teamName: tm.name,
        letter: ltr,
        kind: 'earned',
        totalWord: KEMP_LETTERS.slice(0, tm.letters).join(''),
      });
    } else if (info.beneficiaryTeam !== null && info.beneficiaryTeam !== undefined) {
      const tm = rm.teams[info.beneficiaryTeam];
      const ltr = KEMP_LETTERS[tm.letters] || 'P';
      tm.letters = Math.min(4, tm.letters + 1);
      letterChanges.push({
        teamIndex: tm.index,
        teamName: tm.name,
        letter: ltr,
        kind: 'earned',
        totalWord: KEMP_LETTERS.slice(0, tm.letters).join(''),
      });
    } else {
      const opps = activeTeams.filter((t) => t.index !== info.faultTeam);
      const cap = opps.length > 1 && opps.filter((t) => t.letters + 1 >= 4).length > 1 ? 3 : 4;
      opps.forEach((tm) => {
        if (tm.letters < cap) {
          const ltr = KEMP_LETTERS[tm.letters];
          tm.letters += 1;
          letterChanges.push({
            teamIndex: tm.index,
            teamName: tm.name,
            letter: ltr,
            kind: 'earned',
            totalWord: KEMP_LETTERS.slice(0, tm.letters).join(''),
          });
        }
      });
    }
  } else {
    const targets = info.success
      ? info.caughtTeams?.length
        ? info.caughtTeams.map((i) => rm.teams[i])
        : activeTeams.filter((t) => t.index !== info.winTeam)
      : [rm.teams[info.faultTeam]];

    targets.forEach((tm) => {
      const ltr = KEMP_LETTERS[tm.letters] || 'P';
      tm.letters = Math.min(4, tm.letters + 1);
      if (tm.letters >= 4) tm.eliminated = true;
      letterChanges.push({
        teamIndex: tm.index,
        teamName: tm.name,
        letter: ltr,
        kind: 'penalty',
        eliminated: tm.eliminated,
        totalWord: KEMP_LETTERS.slice(0, tm.letters).join(''),
      });
    });
  }

  const revealedHands = {};
  Object.values(rm.players).forEach((p) => {
    if (p.hand?.length === 4) {
      const q = evalQuad(p.hand);
      revealedHands[p.id] = {
        playerId: p.id,
        playerName: p.name,
        teamIndex: p.teamIndex,
        cards: [...p.hand],
        fourOfAKind: q.match,
        matchedRank: q.rank,
      };
    }
    p.nextRoundReady = Boolean(p.isBot);
  });

  let winner = null;
  if (rm.settings.kempScoringMode === 'earn') {
    const c = rm.teams.slice(0, rm.settings.numTeams).find((t) => t.letters >= 4);
    if (c) winner = c.index;
  } else {
    const rem = getActiveTeams(rm);
    if (rem.length === 1) winner = rem[0].index;
  }

  rm.matchWinnerTeam = winner;
  rm.phase = winner !== null ? 'match_over' : 'round_over';
  rm.roundSummary = {
    ...info,
    letterChanges,
    revealedHands,
    matchWinnerTeam: winner,
    timestamp: Date.now(),
  };
  rm.lastAction = {
    timestamp: Date.now(),
    event: { kind: 'showdown', callType: info.callType, success: info.success },
  };
}

function runBotsStep(rm) {
  if (rm.phase !== 'playing') return;
  const now = Date.now();
  const bots = getActivePlayers(rm).filter((p) => p.isBot);
  for (const bot of bots) {
    if (rm.phase !== 'playing') break;
    const hud = rm.teamHuddles[bot.teamIndex];
    const partner = getPartner(rm, bot.id);

    if (partner && hud?.botTellKey) {
      const pt = rm.activeTells[partner.id];
      if (pt && pt.tellKey === hud.botTellKey && pt.expiresAt > now && now - pt.timestamp > 950) {
        executeKemp(rm, bot.id);
        return;
      }
    }

    if (evalQuad(bot.hand).match) {
      if (hud?.botTellKey && (!rm.activeTells[bot.id] || rm.activeTells[bot.id].expiresAt <= now)) {
        sendTellOnRoom(rm, bot.id, hud.botTellKey);
      }
      continue;
    }

    const best = chooseBotSwap(bot.hand, rm.centerCards);
    if (best) {
      swapCardOnRoom(rm, bot.id, best.discardId, best.cIdx, rm.centerCards[best.cIdx]?.id);
      return;
    }

    if (!rm.flushVotes[bot.id] && now - rm.lastFlushAt > 2800) {
      toggleFlushOnRoom(rm, bot.id);
      return;
    }
  }
}

function chooseBotSwap(hand, center) {
  const score = (cards) => {
    const cnt = {};
    cards.forEach((c) => (cnt[c.rank] = (cnt[c.rank] || 0) + 1));
    return Object.values(cnt).reduce((s, n) => s + (n === 4 ? 1000 : n === 3 ? 90 : n === 2 ? 20 : 1), 0);
  };
  const base = score(hand);
  let best = null;
  let gain = 0;
  center.forEach((cc, cIdx) => {
    hand.forEach((hc, hIdx) => {
      if (cc.rank === hc.rank) return;
      const sim = [...hand];
      sim[hIdx] = cc;
      const g = score(sim) - base;
      if (g > gain) {
        gain = g;
        best = { discardId: hc.id, cIdx };
      }
    });
  });
  return best;
}

function projectRoomForViewer(rm, viewerId) {
  const now = Date.now();
  const viewer = rm.players[viewerId] || null;
  const showAll = rm.phase === 'round_over' || rm.phase === 'match_over';

  const visibleTells = Object.values(rm.activeTells || {}).filter((t) => t.expiresAt > now);
  const playersList = Object.values(rm.players).map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    connected: p.connected,
    teamIndex: p.teamIndex,
    seatIndex: p.seatIndex,
    cardCount: (p.hand || []).length,
    huddleReady: Boolean(p.huddleReady),
    nextRoundReady: Boolean(p.nextRoundReady),
    flushVoted: Boolean(rm.flushVotes?.[p.id]),
    lastSwapAt: p.lastSwapAt || 0,
    hand: p.id === viewerId || showAll ? p.hand || [] : null,
  }));

  let myHuddle = null;
  if (viewer && viewer.teamIndex !== null && rm.teamHuddles?.[viewer.teamIndex]) {
    const h = rm.teamHuddles[viewer.teamIndex];
    myHuddle = {
      messages: rm.phase === 'huddle' ? h.messages || [] : [],
      signalNote: h.signalNote || '',
      botTellKey: h.botTellKey || null,
    };
  }

  return {
    code: rm.code,
    serverNow: now,
    hostId: rm.hostId,
    youId: viewerId,
    phase: rm.phase,
    roundNumber: rm.roundNumber,
    settings: { ...rm.settings },
    teams: rm.teams.slice(0, rm.settings.numTeams).map((t) => ({
      index: t.index,
      name: t.name,
      accent: t.accent,
      letters: t.letters,
      word: KEMP_LETTERS.slice(0, t.letters).join(''),
      eliminated: t.eliminated,
      seats: t.seats.map((s) => s || null),
    })),
    players: playersList,
    centerCards: rm.centerCards || [],
    deckRemaining: (rm.deck || []).length,
    discardCount: (rm.discardPile || []).length,
    flushVoteCount: Object.keys(rm.flushVotes || {}).length,
    activePlayerCount: getActivePlayers(rm).length,
    flushCount: rm.flushCount || 0,
    countdownEndsAt: rm.countdownEndsAt || 0,
    huddleEndsAt: rm.huddleEndsAt || 0,
    accusation: rm.accusation || null,
    lastAction: rm.lastAction || null,
    activeTells: visibleTells,
    myHuddle,
    roundSummary: rm.roundSummary || null,
    matchWinnerTeam: rm.matchWinnerTeam ?? null,
  };
}

/**
 * In-browser static fallback transport (used on GitHub Pages until FIREBASE_CONFIG is pasted).
 * Supports full solo/bot play AND multi-tab same-browser sync via BroadcastChannel + localStorage.
 */
export function createLocalPracticeTransport(onEvent) {
  let tabId = sessionStorage.getItem('kemp_local_tab_id');
  if (!tabId) {
    tabId = `local_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('kemp_local_tab_id', tabId);
  }

  let activeCode = null;
  let lastTs = 0;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('kemp_local_rooms') : null;

  function loadRoom(code) {
    try {
      const raw = localStorage.getItem(`kemp_room_${code}`);
      return raw ? normalizeRoom(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function saveAndBroadcast(rm) {
    rm.updatedAt = Date.now();
    try {
      localStorage.setItem(`kemp_room_${rm.code}`, JSON.stringify(rm));
    } catch {}
    emitProjected(rm);
    channel?.postMessage({ code: rm.code });
  }

  function emitProjected(rm) {
    let evt = null;
    if (rm.lastAction && rm.lastAction.timestamp > lastTs) {
      lastTs = rm.lastAction.timestamp;
      evt = rm.lastAction.event || null;
    }
    onEvent({ type: 'room_state', state: projectRoomForViewer(rm, tabId), event: evt });
  }

  if (channel) {
    channel.onmessage = (ev) => {
      if (activeCode && ev.data?.code === activeCode) {
        const rm = loadRoom(activeCode);
        if (rm) emitProjected(rm);
      }
    };
  }

  setTimeout(() => {
    onEvent({
      type: 'welcome',
      tells: Object.values(TABLE_TELLS),
      signalSuggestions: SIGNAL_SUGGESTIONS,
    });
  }, 0);

  const tick = setInterval(() => {
    if (!activeCode) return;
    const rm = loadRoom(activeCode);
    if (!rm || rm.hostId !== tabId) return;

    const now = Date.now();
    if (rm.phase === 'huddle' && rm.huddleEndsAt > 0 && now >= rm.huddleEndsAt) {
      dealCardsOnRoom(rm, 2200);
      saveAndBroadcast(rm);
    } else if (rm.phase === 'countdown' && now >= rm.countdownEndsAt) {
      rm.phase = 'playing';
      rm.countdownEndsAt = 0;
      rm.lastFlushAt = now;
      rm.lastAction = { timestamp: now, event: { kind: 'round_live' } };
      saveAndBroadcast(rm);
    } else if (rm.phase === 'accusing' && rm.accusation && now >= rm.accusation.expiresAt) {
      const opps = getActivePlayers(rm).filter((p) => p.teamIndex !== rm.accusation.callerTeam);
      if (opps.length > 0) {
        executeNotKemp(rm, rm.accusation.callerId, opps[randInt(opps.length)].id);
        saveAndBroadcast(rm);
      }
    } else if (rm.phase === 'playing') {
      if (getActivePlayers(rm).some((p) => p.isBot) && Math.random() < 0.5) {
        const before = JSON.stringify(rm);
        runBotsStep(rm);
        if (JSON.stringify(rm) !== before) saveAndBroadcast(rm);
      }
    }
  }, 450);

  return {
    destroy() {
      clearInterval(tick);
      channel?.close();
    },

    send(msg) {
      const { type } = msg || {};

      if (type === 'create_room') {
        const code = genCode();
        const host = makePlayer(tabId, msg.name, false);
        const rm = makeFreshRoom(code, host);
        if (msg.quickDemo) {
          fillBotsOnRoom(rm);
          startMatchOnRoom(rm, tabId);
        } else {
          onEvent({
            type: 'toast',
            kind: 'info',
            message: 'Practice / Same-Browser Mode — add Firebase config to sync across separate phones/laptops!',
          });
        }
        activeCode = code;
        onEvent({ type: 'joined', roomCode: code, playerId: tabId, token: tabId });
        saveAndBroadcast(rm);
        return;
      }

      if (type === 'join_room') {
        const code = String(msg.code || '').trim().toUpperCase();
        const rm = loadRoom(code);
        if (!rm) {
          onEvent({
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            message: `Room "${code}" not found on this browser (paste firebaseConfig to link separate devices!).`,
          });
          return;
        }
        let p = rm.players[tabId];
        if (p) {
          p.connected = true;
          if (msg.name) p.name = cleanName(msg.name);
        } else {
          p = makePlayer(tabId, msg.name, false);
          rm.players[tabId] = p;
          if (rm.phase === 'lobby') autoSeat(rm, tabId);
        }
        activeCode = code;
        onEvent({ type: 'joined', roomCode: code, playerId: tabId, token: tabId });
        saveAndBroadcast(rm);
        return;
      }

      if (type === 'leave_room') {
        activeCode = null;
        onEvent({ type: 'left_room' });
        return;
      }

      if (!activeCode) return;
      const rm = loadRoom(activeCode);
      if (!rm) return;

      let res = { ok: true };
      switch (type) {
        case 'select_seat': res = seatOnRoom(rm, tabId, Number(msg.teamIndex), Number(msg.seatIndex)); break;
        case 'add_bot': res = addBotOnRoom(rm, Number(msg.teamIndex), Number(msg.seatIndex)); break;
        case 'fill_bots': res = fillBotsOnRoom(rm); break;
        case 'remove_player': {
          const tgt = rm.players[msg.targetId];
          if (tgt && tgt.id !== tabId) {
            if (tgt.teamIndex !== null && rm.teams[tgt.teamIndex]?.seats[tgt.seatIndex] === tgt.id) {
              rm.teams[tgt.teamIndex].seats[tgt.seatIndex] = '';
            }
            delete rm.players[tgt.id];
          }
          break;
        }
        case 'update_settings': res = updateSettingsOnRoom(rm, tabId, msg.settings || {}); break;
        case 'start_match': res = startMatchOnRoom(rm, tabId); break;
        case 'huddle_message': res = addHuddleMsg(rm, tabId, msg.text); break;
        case 'huddle_signal': res = setSignalOnRoom(rm, tabId, msg.signalNote); break;
        case 'huddle_ready': res = toggleReadyOnRoom(rm, tabId); break;
        case 'swap_card': res = swapCardOnRoom(rm, tabId, msg.handCardId, Number(msg.centerIndex), msg.expectedCenterCardId); break;
        case 'toggle_flush': res = toggleFlushOnRoom(rm, tabId); break;
        case 'table_tell': res = sendTellOnRoom(rm, tabId, msg.tellKey); break;
        case 'call_kemp': res = executeKemp(rm, tabId); break;
        case 'call_not_kemp': res = executeNotKemp(rm, tabId, msg.targetPlayerId || null); break;
        case 'next_round': enterHuddleOnRoom(rm); break;
        case 'return_lobby':
          rm.phase = 'lobby';
          rm.roundNumber = 0;
          rm.centerCards = [];
          rm.roundSummary = null;
          rm.matchWinnerTeam = null;
          rm.teams.forEach((t) => { t.letters = 0; t.eliminated = false; });
          Object.values(rm.players).forEach((p) => { p.hand = []; p.huddleReady = false; });
          break;
      }

      if (res && res.ok === false) {
        if (res.code === 'RACE_LOST') onEvent({ type: 'swap_rejected', code: res.code, message: res.message });
        else if (res.message) onEvent({ type: 'toast', kind: 'warn', message: res.message });
        return;
      }
      saveAndBroadcast(rm);
    },
  };
}
