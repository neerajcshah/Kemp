import crypto from 'node:crypto';

export const KEMP_LETTERS = ['K', 'E', 'M', 'P'];

export const TEAM_CONFIGS = [
  { index: 0, name: 'Emerald', accent: 'emerald' },
  { index: 1, name: 'Vermilion', accent: 'vermilion' },
  { index: 2, name: 'Ochre', accent: 'ochre' },
  { index: 3, name: 'Cobalt', accent: 'cobalt' },
];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['S', 'H', 'D', 'C'];

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
  'camille (Bot)',
  'Julian (Bot)',
  'Sora (Bot)',
];

/**
 * Build and Fisher-Yates shuffle a standard 52-card deck.
 */
export function createShuffledDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return shuffleArray(deck);
}

export function shuffleArray(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Evaluate whether a 4-card hand is four-of-a-kind.
 */
export function evaluateFourOfAKind(hand) {
  if (!Array.isArray(hand) || hand.length !== 4) {
    return { match: false, rank: null };
  }
  const firstRank = hand[0].rank;
  const allSame = hand.every((card) => card && card.rank === firstRank);
  return { match: allSame, rank: allSame ? firstRank : null };
}

/**
 * Generate a readable 4-letter room code avoiding ambiguous characters.
 */
export function generateRoomCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += alphabet[crypto.randomInt(0, alphabet.length)];
    }
    if (!existingCodes.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
}

/**
 * Validate and normalize an optional Google Meet URL.
 */
export function sanitizeMeetUrl(rawUrl) {
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

/**
 * Create a fresh room state.
 */
export function createRoom(code, hostPlayer) {
  const room = {
    code,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hostId: hostPlayer.id,
    phase: 'lobby', // 'lobby' | 'huddle' | 'countdown' | 'playing' | 'accusing' | 'round_over' | 'match_over'
    roundNumber: 0,
    settings: {
      numTeams: 2, // 2, 3, or 4 teams of 2
      notKempMode: 'specific', // 'specific' (accuse exact opponent) | 'any' (general stop)
      kempScoringMode: 'earn', // 'earn' (first to K-E-M-P wins) | 'penalty' (K-E-M-P eliminates)
      huddleSeconds: 0, // 0 = untimed ready-check, or 30/45/60
      meetUrl: '',
    },
    teams: TEAM_CONFIGS.map((cfg) => ({
      index: cfg.index,
      name: cfg.name,
      accent: cfg.accent,
      letters: 0, // 0..4 -> K-E-M-P
      eliminated: false,
      seats: [null, null], // player IDs
    })),
    players: new Map(), // playerId -> player object
    teamHuddles: new Map(), // teamIndex -> { messages: [], signalNote: '', botTellKey: null }
    deck: [],
    discardPile: [],
    centerCards: [],
    flushVotes: new Set(),
    flushCount: 0,
    lastFlushAt: 0,
    countdownEndsAt: 0,
    huddleEndsAt: 0,
    accusation: null, // { callerId, callerName, callerTeam, expiresAt }
    lastAction: null,
    recentSwaps: [],
    activeTells: new Map(), // playerId -> { tellKey, label, icon, expiresAt }
    roundSummary: null,
    matchWinnerTeam: null,
  };

  addPlayerToRoom(room, hostPlayer, 0, 0);
  return room;
}

export function createPlayerRecord({ id, token, name, isBot = false }) {
  return {
    id: id || crypto.randomUUID(),
    token: token || crypto.randomUUID(),
    name: sanitizePlayerName(name, isBot),
    isBot,
    connected: true,
    teamIndex: null,
    seatIndex: null,
    hand: [],
    huddleReady: false,
    nextRoundReady: false,
    lastSwapAt: 0,
    lastSwap: null,
  };
}

export function sanitizePlayerName(name, isBot = false) {
  const cleaned = String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22);
  if (cleaned) return cleaned;
  return isBot ? 'Card Bot' : 'Player';
}

/**
 * Add or seat a player into a room.
 */
export function addPlayerToRoom(room, player, preferredTeam = null, preferredSeat = null) {
  room.players.set(player.id, player);
  if (preferredTeam !== null && preferredSeat !== null) {
    seatPlayer(room, player.id, preferredTeam, preferredSeat);
  } else {
    autoSeatPlayer(room, player.id);
  }
  room.updatedAt = Date.now();
  return player;
}

export function autoSeatPlayer(room, playerId) {
  for (let t = 0; t < room.settings.numTeams; t++) {
    for (let s = 0; s < 2; s++) {
      if (!room.teams[t].seats[s]) {
        return seatPlayer(room, playerId, t, s);
      }
    }
  }
  return { ok: true, spectator: true };
}

export function seatPlayer(room, playerId, teamIndex, seatIndex) {
  if (room.phase !== 'lobby') {
    return { ok: false, message: 'Seats can only be changed in the lobby.' };
  }
  if (teamIndex < 0 || teamIndex >= room.settings.numTeams || (seatIndex !== 0 && seatIndex !== 1)) {
    return { ok: false, message: 'Invalid team or seat.' };
  }
  const targetOccupant = room.teams[teamIndex].seats[seatIndex];
  if (targetOccupant && targetOccupant !== playerId) {
    return { ok: false, message: 'That seat is already taken.' };
  }

  const player = room.players.get(playerId);
  if (!player) return { ok: false, message: 'Player not found.' };

  // Vacate old seat if any
  if (player.teamIndex !== null && player.seatIndex !== null) {
    const oldTeam = room.teams[player.teamIndex];
    if (oldTeam && oldTeam.seats[player.seatIndex] === playerId) {
      oldTeam.seats[player.seatIndex] = null;
    }
  }

  room.teams[teamIndex].seats[seatIndex] = playerId;
  player.teamIndex = teamIndex;
  player.seatIndex = seatIndex;
  room.updatedAt = Date.now();
  return { ok: true };
}

/**
 * Remove a player or bot from a room.
 */
export function removePlayerFromRoom(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return { ok: false };

  if (player.teamIndex !== null && player.seatIndex !== null) {
    const team = room.teams[player.teamIndex];
    if (team && team.seats[player.seatIndex] === playerId) {
      team.seats[player.seatIndex] = null;
    }
  }
  room.players.delete(playerId);
  room.flushVotes.delete(playerId);

  if (room.hostId === playerId) {
    const nextHuman = [...room.players.values()].find((p) => !p.isBot && p.connected) ||
      [...room.players.values()].find((p) => !p.isBot);
    room.hostId = nextHuman ? nextHuman.id : null;
  }

  room.updatedAt = Date.now();
  return { ok: true };
}

/**
 * Add a bot to a specific empty seat or fill all empty seats.
 */
export function addBotToSeat(room, teamIndex, seatIndex) {
  if (room.phase !== 'lobby') {
    return { ok: false, message: 'Bots can only be added in the lobby.' };
  }
  if (teamIndex < 0 || teamIndex >= room.settings.numTeams || (seatIndex !== 0 && seatIndex !== 1)) {
    return { ok: false, message: 'Invalid seat.' };
  }
  if (room.teams[teamIndex].seats[seatIndex]) {
    return { ok: false, message: 'Seat is already occupied.' };
  }

  const takenNames = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
  const botName =
    BOT_NAMES.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).find(
      (n) => !takenNames.has(n.toLowerCase())
    ) || `Bot ${room.players.size + 1}`;

  const bot = createPlayerRecord({ name: botName, isBot: true });
  addPlayerToRoom(room, bot, teamIndex, seatIndex);
  return { ok: true, bot };
}

export function fillEmptySeatsWithBots(room) {
  if (room.phase !== 'lobby') {
    return { ok: false, message: 'Bots can only be added in the lobby.' };
  }
  const added = [];
  for (let t = 0; t < room.settings.numTeams; t++) {
    for (let s = 0; s < 2; s++) {
      if (!room.teams[t].seats[s]) {
        const res = addBotToSeat(room, t, s);
        if (res.ok) added.push(res.bot);
      }
    }
  }
  return { ok: true, added };
}

/**
 * Update room settings (host only).
 */
export function updateRoomSettings(room, actorId, patch) {
  if (actorId !== room.hostId) {
    return { ok: false, message: 'Only the room host can change settings.' };
  }

  if (patch.meetUrl !== undefined) {
    const cleaned = sanitizeMeetUrl(patch.meetUrl);
    if (patch.meetUrl.trim() !== '' && !cleaned) {
      return { ok: false, message: 'Please enter a valid Google Meet link (meet.google.com/...) or leave blank.' };
    }
    room.settings.meetUrl = cleaned;
  }

  if (room.phase !== 'lobby') {
    room.updatedAt = Date.now();
    return { ok: true };
  }

  if (patch.numTeams !== undefined) {
    const n = Number(patch.numTeams);
    if ([2, 3, 4].includes(n)) {
      // Unseat players or remove bots on trimmed teams
      for (let t = n; t < 4; t++) {
        for (let s = 0; s < 2; s++) {
          const pid = room.teams[t].seats[s];
          if (pid) {
            const p = room.players.get(pid);
            room.teams[t].seats[s] = null;
            if (p) {
              if (p.isBot) {
                room.players.delete(pid);
              } else {
                p.teamIndex = null;
                p.seatIndex = null;
                autoSeatPlayer(room, pid);
              }
            }
          }
        }
      }
      room.settings.numTeams = n;
    }
  }

  if (patch.notKempMode === 'specific' || patch.notKempMode === 'any') {
    room.settings.notKempMode = patch.notKempMode;
  }

  if (patch.kempScoringMode === 'earn' || patch.kempScoringMode === 'penalty') {
    room.settings.kempScoringMode = patch.kempScoringMode;
  }

  if (patch.huddleSeconds !== undefined) {
    const sec = Number(patch.huddleSeconds);
    if ([0, 30, 45, 60].includes(sec)) {
      room.settings.huddleSeconds = sec;
    }
  }

  room.updatedAt = Date.now();
  return { ok: true };
}

/**
 * Return active (non-eliminated) team objects within numTeams.
 */
export function getActiveTeams(room) {
  return room.teams.slice(0, room.settings.numTeams).filter((t) => !t.eliminated);
}

/**
 * Return all seated players on active (non-eliminated) teams.
 */
export function getActivePlayers(room) {
  const players = [];
  for (const team of getActiveTeams(room)) {
    for (const pid of team.seats) {
      if (pid) {
        const p = room.players.get(pid);
        if (p) players.push(p);
      }
    }
  }
  return players;
}

export function getPartner(room, playerId) {
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null) return null;
  const team = room.teams[player.teamIndex];
  if (!team) return null;
  const partnerId = team.seats[player.seatIndex === 0 ? 1 : 0];
  return partnerId ? room.players.get(partnerId) || null : null;
}

/**
 * Validate that all active seats are filled and start match / round huddle.
 */
export function startMatch(room, actorId) {
  if (actorId !== room.hostId) {
    return { ok: false, message: 'Only the room host can start the match.' };
  }
  if (room.phase !== 'lobby' && room.phase !== 'match_over') {
    return { ok: false, message: 'Match is already in progress.' };
  }

  for (let t = 0; t < room.settings.numTeams; t++) {
    if (!room.teams[t].seats[0] || !room.teams[t].seats[1]) {
      return {
        ok: false,
        message: `Every team needs 2 players before starting. Fill empty seats or add bots.`,
      };
    }
  }

  // Reset match scores
  room.roundNumber = 0;
  room.matchWinnerTeam = null;
  room.roundSummary = null;
  for (let t = 0; t < 4; t++) {
    room.teams[t].letters = 0;
    room.teams[t].eliminated = false;
  }

  return startRoundHuddle(room);
}

/**
 * Enter the private Partner Secret Huddle phase before dealing cards.
 */
export function startRoundHuddle(room) {
  room.roundNumber += 1;
  room.phase = 'huddle';
  room.centerCards = [];
  room.deck = [];
  room.discardPile = [];
  room.flushVotes.clear();
  room.flushCount = 0;
  room.accusation = null;
  room.roundSummary = null;
  room.lastAction = null;
  room.activeTells.clear();
  room.huddleEndsAt =
    room.settings.huddleSeconds > 0 ? Date.now() + room.settings.huddleSeconds * 1000 : 0;

  const tellKeys = Object.keys(TABLE_TELLS);

  for (const team of getActiveTeams(room)) {
    const prevHuddle = room.teamHuddles.get(team.index);

    const p0 = room.players.get(team.seats[0]);
    const p1 = room.players.get(team.seats[1]);
    const hasBot = Boolean((p0 && p0.isBot) || (p1 && p1.isBot));
    const hasHuman = Boolean((p0 && !p0.isBot) || (p1 && !p1.isBot));

    const chosenTellKey = hasBot
      ? tellKeys[crypto.randomInt(0, tellKeys.length)]
      : prevHuddle?.teamTellKey || tellKeys[team.index % tellKeys.length];
    const chosenInfo = TABLE_TELLS[chosenTellKey];

    const messages = [];
    let signalNote = prevHuddle?.signalNote || `${chosenInfo.label} = 4-of-a-kind`;

    if (hasBot) {
      const botPlayer = p0?.isBot ? p0 : p1;
      signalNote = `${chosenInfo.label} = 4-of-a-kind`;
      if (hasHuman && botPlayer) {
        messages.push({
          id: crypto.randomUUID(),
          senderId: botPlayer.id,
          senderName: botPlayer.name,
          text: `Round ${room.roundNumber} plan: Watch me — I will "${chosenInfo.label}" when I get 4-of-a-kind! Press the glowing "${chosenInfo.label}" signal button if YOU get 4-of-a-kind and I'll yell KEMP!`,
          timestamp: Date.now(),
        });
      }
    }

    room.teamHuddles.set(team.index, {
      messages,
      signalNote,
      teamTellKey: chosenTellKey,
      botTellKey: chosenTellKey,
    });
  }

  room.recentSwaps = [];

  for (const p of room.players.values()) {
    p.hand = [];
    p.lastSwap = null;
    p.nextRoundReady = false;
    const onActiveTeam =
      p.teamIndex !== null &&
      p.teamIndex < room.settings.numTeams &&
      !room.teams[p.teamIndex].eliminated;
    p.huddleReady = Boolean(onActiveTeam && p.isBot);
  }

  room.updatedAt = Date.now();

  // If every active player is already ready (e.g., all bots), deal immediately
  if (allActivePlayersHuddleReady(room)) {
    beginCountdownAndDeal(room);
  }

  return { ok: true };
}

export function allActivePlayersHuddleReady(room) {
  const active = getActivePlayers(room);
  return active.length > 0 && active.every((p) => p.huddleReady);
}

export function sendHuddleMessage(room, playerId, text) {
  if (room.phase !== 'huddle') {
    return { ok: false, message: 'Partner chat is locked once the round begins!' };
  }
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null) {
    return { ok: false, message: 'You must be on a team to huddle.' };
  }
  const cleanText = String(text || '').trim().slice(0, 200);
  if (!cleanText) return { ok: false, message: 'Empty message.' };

  const huddle = room.teamHuddles.get(player.teamIndex);
  if (!huddle) return { ok: false, message: 'Team huddle unavailable.' };

  huddle.messages.push({
    id: crypto.randomUUID(),
    senderId: player.id,
    senderName: player.name,
    text: cleanText,
    timestamp: Date.now(),
  });
  if (huddle.messages.length > 30) {
    huddle.messages.shift();
  }
  room.updatedAt = Date.now();
  return { ok: true };
}

export function setTeamSignalNote(room, playerId, signalNote) {
  if (room.phase !== 'huddle') {
    return { ok: false, message: 'Signal note is locked once cards are dealt.' };
  }
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null) {
    return { ok: false, message: 'Not on a team.' };
  }
  const huddle = room.teamHuddles.get(player.teamIndex);
  if (!huddle) return { ok: false, message: 'Team huddle unavailable.' };

  huddle.signalNote = String(signalNote || '').trim().slice(0, 90);
  room.updatedAt = Date.now();
  return { ok: true };
}

export function setTeamTellKey(room, playerId, tellKey) {
  if (room.phase !== 'huddle') {
    return { ok: false, message: 'Team signal is locked once cards are dealt.' };
  }
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null) {
    return { ok: false, message: 'Not on a team.' };
  }
  const tell = TABLE_TELLS[tellKey];
  if (!tell) {
    return { ok: false, message: 'Invalid signal gesture.' };
  }
  const huddle = room.teamHuddles.get(player.teamIndex);
  if (!huddle) return { ok: false, message: 'Team huddle unavailable.' };

  huddle.teamTellKey = tell.key;
  huddle.botTellKey = tell.key;
  huddle.signalNote = `${tell.label} = 4-of-a-kind`;
  room.updatedAt = Date.now();
  return { ok: true };
}

export function toggleHuddleReady(room, playerId) {
  if (room.phase !== 'huddle') {
    return { ok: false, message: 'Not in huddle phase.' };
  }
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null) {
    return { ok: false, message: 'Not on an active team.' };
  }
  player.huddleReady = !player.huddleReady;
  room.updatedAt = Date.now();

  if (allActivePlayersHuddleReady(room)) {
    beginCountdownAndDeal(room);
  }
  return { ok: true, dealt: room.phase !== 'huddle' };
}

/**
 * Lock huddle chats, deal 4 cards to each active player + 4 center cards, and start countdown.
 */
export function beginCountdownAndDeal(room, countdownMs = 2200) {
  const activePlayers = getActivePlayers(room);
  let deck = createShuffledDeck();

  // Re-deal if anyone happens to get a natural 4-of-a-kind off the shuffle
  for (let attempt = 0; attempt < 12; attempt++) {
    deck = createShuffledDeck();
    let naturalQuad = false;
    for (let i = 0; i < activePlayers.length; i++) {
      const sampleHand = deck.slice(i * 4, i * 4 + 4);
      if (evaluateFourOfAKind(sampleHand).match) {
        naturalQuad = true;
        break;
      }
    }
    if (!naturalQuad) break;
  }

  for (const player of activePlayers) {
    player.hand = sortHand(deck.splice(0, 4));
    player.lastSwapAt = 0;
    player.lastSwap = null;
  }

  room.centerCards = deck.splice(0, 4);
  room.deck = deck;
  room.discardPile = [];
  room.recentSwaps = [];
  room.flushVotes.clear();
  room.flushCount = 0;
  room.lastFlushAt = Date.now();
  room.activeTells.clear();
  room.huddleEndsAt = 0;

  if (countdownMs > 0) {
    room.phase = 'countdown';
    room.countdownEndsAt = Date.now() + countdownMs;
  } else {
    room.phase = 'playing';
    room.countdownEndsAt = 0;
  }

  room.lastAction = { type: 'deal', timestamp: Date.now() };
  room.updatedAt = Date.now();
  return { ok: true };
}

export function finishCountdownIfReady(room) {
  if (room.phase === 'countdown' && Date.now() >= room.countdownEndsAt) {
    room.phase = 'playing';
    room.countdownEndsAt = 0;
    room.lastFlushAt = Date.now();
    room.updatedAt = Date.now();
    return true;
  }
  return false;
}

const RANK_ORDER = Object.fromEntries(RANKS.map((r, idx) => [r, idx]));
const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };

export function sortHand(hand) {
  return [...hand].sort((a, b) => {
    const rDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rDiff !== 0) return rDiff;
    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  });
}

/**
 * Simultaneous race-safe swap between 1 card in a player's hand and 1 center card.
 */
export function swapCard(room, playerId, handCardId, centerIndex, expectedCenterCardId = null) {
  if (room.phase !== 'playing') {
    return { ok: false, code: 'NOT_PLAYING', message: 'Cards cannot be swapped right now.' };
  }
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null || room.teams[player.teamIndex]?.eliminated) {
    return { ok: false, code: 'INACTIVE_PLAYER', message: 'You are not active in this round.' };
  }

  const cIdx = Number(centerIndex);
  if (!Number.isInteger(cIdx) || cIdx < 0 || cIdx >= room.centerCards.length) {
    return { ok: false, code: 'BAD_CENTER_SLOT', message: 'Invalid center card slot.' };
  }

  const centerCard = room.centerCards[cIdx];
  if (!centerCard) {
    return { ok: false, code: 'EMPTY_SLOT', message: 'No card in that center slot.' };
  }

  if (expectedCenterCardId && centerCard.id !== expectedCenterCardId) {
    return {
      ok: false,
      code: 'RACE_LOST',
      message: 'Snatched! Someone grabbed that card a split-second earlier.',
    };
  }

  const handIdx = player.hand.findIndex((c) => c.id === handCardId);
  if (handIdx === -1) {
    return { ok: false, code: 'CARD_NOT_IN_HAND', message: 'Selected card is no longer in your hand.' };
  }

  const discardedCard = player.hand[handIdx];
  player.hand[handIdx] = centerCard;
  room.centerCards[cIdx] = discardedCard;
  const now = Date.now();
  player.lastSwapAt = now;
  player.lastSwap = {
    pickedUp: centerCard,
    discarded: discardedCard,
    centerIndex: cIdx,
    timestamp: now,
  };

  // Reset center flush votes because a new card entered the center
  room.flushVotes.clear();

  const swapRecord = {
    id: crypto.randomUUID(),
    type: 'swap',
    playerId: player.id,
    playerName: player.name,
    teamIndex: player.teamIndex,
    centerIndex: cIdx,
    pickedUp: centerCard,
    discarded: discardedCard,
    timestamp: now,
  };
  room.recentSwaps = [swapRecord, ...(room.recentSwaps || [])].slice(0, 5);
  room.lastAction = swapRecord;
  room.updatedAt = now;

  return { ok: true, pickedUp: centerCard, discarded: discardedCard };
}

/**
 * Vote to flush (discard) the 4 center cards and deal 4 fresh ones when all active players agree.
 */
export function toggleFlushVote(room, playerId) {
  if (room.phase !== 'playing') {
    return { ok: false, message: 'Cannot vote to flush right now.' };
  }
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null || room.teams[player.teamIndex]?.eliminated) {
    return { ok: false, message: 'Inactive player.' };
  }

  if (room.flushVotes.has(playerId)) {
    room.flushVotes.delete(playerId);
    room.updatedAt = Date.now();
    return { ok: true, flushed: false };
  }

  room.flushVotes.add(playerId);
  const activePlayers = getActivePlayers(room);
  const allAgreed = activePlayers.every((p) => room.flushVotes.has(p.id));

  if (allAgreed) {
    performCenterFlush(room);
    return { ok: true, flushed: true };
  }

  room.updatedAt = Date.now();
  return { ok: true, flushed: false };
}

export function performCenterFlush(room) {
  room.discardPile.push(...room.centerCards);
  room.centerCards = [];
  room.flushVotes.clear();

  // Recycle discard pile if fewer than 4 cards remain in stock
  if (room.deck.length < 4 && room.discardPile.length > 0) {
    room.deck.push(...shuffleArray(room.discardPile));
    room.discardPile = [];
  }

  const drawCount = Math.min(4, room.deck.length);
  room.centerCards = room.deck.splice(0, drawCount);
  room.flushCount += 1;
  room.lastFlushAt = Date.now();
  room.lastAction = {
    type: 'flush',
    flushCount: room.flushCount,
    timestamp: Date.now(),
  };
  room.updatedAt = Date.now();
}

/**
 * Broadcast a subtle table tell visible to all players for ~2.8 seconds.
 */
export function triggerTableTell(room, playerId, tellKey) {
  if (room.phase !== 'playing') {
    return { ok: false, message: 'Table tells are only active during live play.' };
  }
  const player = room.players.get(playerId);
  if (!player || player.teamIndex === null || room.teams[player.teamIndex]?.eliminated) {
    return { ok: false, message: 'Inactive player.' };
  }
  const tell = TABLE_TELLS[tellKey];
  if (!tell) return { ok: false, message: 'Unknown table gesture.' };

  const now = Date.now();
  room.activeTells.set(playerId, {
    playerId,
    playerName: player.name,
    teamIndex: player.teamIndex,
    tellKey: tell.key,
    label: tell.label,
    icon: tell.icon,
    timestamp: now,
    expiresAt: now + 4500,
  });
  room.lastAction = {
    type: 'tell',
    playerId,
    playerName: player.name,
    tellKey: tell.key,
    timestamp: now,
  };
  room.updatedAt = now;
  return { ok: true };
}

/**
 * Player yells "KEMP!" — claiming their PARTNER currently holds 4-of-a-kind.
 */
export function callKemp(room, callerId) {
  if (room.phase !== 'playing') {
    return { ok: false, message: 'Kemp can only be called during active play.' };
  }
  const caller = room.players.get(callerId);
  if (!caller || caller.teamIndex === null || room.teams[caller.teamIndex]?.eliminated) {
    return { ok: false, message: 'You are not an active player.' };
  }

  const partner = getPartner(room, callerId);
  if (!partner) {
    return { ok: false, message: 'No partner found.' };
  }

  const check = evaluateFourOfAKind(partner.hand);
  const callerTeam = room.teams[caller.teamIndex];

  if (check.match) {
    const scoreOutcome = awardValidCall(room, caller.teamIndex, null, {
      callType: 'kemp',
      success: true,
      callerId: caller.id,
      callerName: caller.name,
      callerTeam: caller.teamIndex,
      partnerId: partner.id,
      partnerName: partner.name,
      matchedRank: check.rank,
      headline: `KEMP! ${caller.name} read ${partner.name}'s signal!`,
      detail: `${partner.name} held four ${formatRankPlural(check.rank)}.`,
    });
    return { ok: true, outcome: scoreOutcome };
  } else {
    const callerHadIt = evaluateFourOfAKind(caller.hand).match;
    const hint = callerHadIt
      ? ` (Remember: your partner had to call Kemp for your hand — ${partner.name} didn't have 4-of-a-kind!)`
      : '';
    const scoreOutcome = penalizeFalseCall(room, caller.teamIndex, null, {
      callType: 'kemp',
      success: false,
      callerId: caller.id,
      callerName: caller.name,
      callerTeam: caller.teamIndex,
      partnerId: partner.id,
      partnerName: partner.name,
      matchedRank: null,
      headline: `FALSE KEMP! ${caller.name} jumped the gun!`,
      detail: `${partner.name} did not hold four-of-a-kind for Team ${callerTeam.name}.${hint}`,
    });
    return { ok: true, outcome: scoreOutcome };
  }
}

/**
 * Player yells "NOT KEMP!" — counter-calling an opposing team.
 */
export function callNotKemp(room, callerId, targetPlayerId = null) {
  const caller = room.players.get(callerId);
  if (!caller || caller.teamIndex === null || room.teams[caller.teamIndex]?.eliminated) {
    return { ok: false, message: 'You are not an active player.' };
  }

  // General stop mode: check ALL opposing active players immediately
  if (room.settings.notKempMode === 'any') {
    if (room.phase !== 'playing') {
      return { ok: false, message: 'Not Kemp can only be called during active play.' };
    }
    const opponents = getActivePlayers(room).filter((p) => p.teamIndex !== caller.teamIndex);
    const caught = opponents
      .map((opp) => ({ player: opp, eval: evaluateFourOfAKind(opp.hand) }))
      .filter((entry) => entry.eval.match);

    if (caught.length > 0) {
      const caughtTeams = [...new Set(caught.map((c) => c.player.teamIndex))];
      const names = caught.map((c) => `${c.player.name} (four ${formatRankPlural(c.eval.rank)})`).join(' & ');
      const outcome = awardValidCall(room, caller.teamIndex, caughtTeams, {
        callType: 'not_kemp',
        success: true,
        callerId: caller.id,
        callerName: caller.name,
        callerTeam: caller.teamIndex,
        caughtPlayerIds: caught.map((c) => c.player.id),
        matchedRank: caught[0].eval.rank,
        headline: `NOT KEMP! ${caller.name} intercepted the signal!`,
        detail: `Caught ${names} before their partner could call Kemp!`,
      });
      return { ok: true, outcome };
    } else {
      const outcome = penalizeFalseCall(room, caller.teamIndex, null, {
        callType: 'not_kemp',
        success: false,
        callerId: caller.id,
        callerName: caller.name,
        callerTeam: caller.teamIndex,
        caughtPlayerIds: [],
        matchedRank: null,
        headline: `FALSE NOT KEMP! Nobody had four-of-a-kind!`,
        detail: `${caller.name} called Not Kemp, but every opponent came up clean.`,
      });
      return { ok: true, outcome };
    }
  }

  // Specific opponent accusation mode
  if (!targetPlayerId) {
    if (room.phase !== 'playing') {
      return { ok: false, message: 'Not Kemp can only be called during active play.' };
    }
    room.phase = 'accusing';
    room.accusation = {
      callerId: caller.id,
      callerName: caller.name,
      callerTeam: caller.teamIndex,
      expiresAt: Date.now() + 8000,
    };
    room.lastAction = {
      type: 'freeze_not_kemp',
      playerId: caller.id,
      playerName: caller.name,
      timestamp: Date.now(),
    };
    room.updatedAt = Date.now();
    return { ok: true, awaitingTarget: true };
  }

  if (room.phase !== 'playing' && room.phase !== 'accusing') {
    return { ok: false, message: 'Cannot accuse right now.' };
  }
  if (room.phase === 'accusing' && room.accusation?.callerId !== callerId) {
    return { ok: false, message: `Waiting for ${room.accusation.callerName} to pick an opponent.` };
  }

  const target = room.players.get(targetPlayerId);
  if (
    !target ||
    target.teamIndex === null ||
    target.teamIndex === caller.teamIndex ||
    room.teams[target.teamIndex]?.eliminated
  ) {
    return { ok: false, message: 'Please choose an active opponent.' };
  }

  const check = evaluateFourOfAKind(target.hand);
  room.accusation = null;

  if (check.match) {
    const outcome = awardValidCall(room, caller.teamIndex, [target.teamIndex], {
      callType: 'not_kemp',
      success: true,
      callerId: caller.id,
      callerName: caller.name,
      callerTeam: caller.teamIndex,
      targetId: target.id,
      targetName: target.name,
      caughtPlayerIds: [target.id],
      matchedRank: check.rank,
      headline: `NOT KEMP! ${caller.name} caught ${target.name} red-handed!`,
      detail: `${target.name} was holding four ${formatRankPlural(check.rank)}!`,
    });
    return { ok: true, outcome };
  } else {
    const outcome = penalizeFalseCall(room, caller.teamIndex, target.teamIndex, {
      callType: 'not_kemp',
      success: false,
      callerId: caller.id,
      callerName: caller.name,
      callerTeam: caller.teamIndex,
      targetId: target.id,
      targetName: target.name,
      caughtPlayerIds: [],
      matchedRank: null,
      headline: `WRONG CALL! ${target.name} was bluffing!`,
      detail: `${caller.name} accused ${target.name}, who did not have four-of-a-kind.`,
    });
    return { ok: true, outcome };
  }
}

/**
 * Auto-resolve expired accusation shot clock if caller didn't click an opponent in time.
 */
export function resolveExpiredAccusationIfNeeded(room) {
  if (room.phase !== 'accusing' || !room.accusation) return false;
  if (Date.now() < room.accusation.expiresAt) return false;

  const { callerId, callerTeam } = room.accusation;
  const opponents = getActivePlayers(room).filter((p) => p.teamIndex !== callerTeam);
  if (opponents.length === 0) {
    room.phase = 'playing';
    room.accusation = null;
    return true;
  }
  const randomTarget = opponents[crypto.randomInt(0, opponents.length)];
  callNotKemp(room, callerId, randomTarget.id);
  return true;
}

function awardValidCall(room, winningTeamIndex, caughtTeamIndices, baseSummary) {
  const letterChanges = [];
  const activeTeams = getActiveTeams(room);

  if (room.settings.kempScoringMode === 'earn') {
    const team = room.teams[winningTeamIndex];
    const nextLetter = KEMP_LETTERS[team.letters] || 'P';
    team.letters = Math.min(4, team.letters + 1);
    letterChanges.push({
      teamIndex: team.index,
      teamName: team.name,
      letter: nextLetter,
      kind: 'earned',
      totalWord: KEMP_LETTERS.slice(0, team.letters).join(''),
    });
  } else {
    // Penalty mode: caught teams (or all opposing teams on valid Kemp) take a penalty letter
    const penalizedIndices =
      Array.isArray(caughtTeamIndices) && caughtTeamIndices.length > 0
        ? caughtTeamIndices
        : activeTeams.filter((t) => t.index !== winningTeamIndex).map((t) => t.index);

    for (const tIdx of penalizedIndices) {
      const team = room.teams[tIdx];
      const nextLetter = KEMP_LETTERS[team.letters] || 'P';
      team.letters = Math.min(4, team.letters + 1);
      if (team.letters >= 4) team.eliminated = true;
      letterChanges.push({
        teamIndex: team.index,
        teamName: team.name,
        letter: nextLetter,
        kind: 'penalty',
        eliminated: team.eliminated,
        totalWord: KEMP_LETTERS.slice(0, team.letters).join(''),
      });
    }
  }

  return finalizeRound(room, { ...baseSummary, letterChanges });
}

function penalizeFalseCall(room, faultTeamIndex, specificBeneficiaryTeamIndex, baseSummary) {
  const letterChanges = [];
  const activeTeams = getActiveTeams(room);

  if (room.settings.kempScoringMode === 'earn') {
    if (specificBeneficiaryTeamIndex !== null && specificBeneficiaryTeamIndex !== undefined) {
      // Falsely accused team earns a letter
      const benTeam = room.teams[specificBeneficiaryTeamIndex];
      const nextLetter = KEMP_LETTERS[benTeam.letters] || 'P';
      benTeam.letters = Math.min(4, benTeam.letters + 1);
      letterChanges.push({
        teamIndex: benTeam.index,
        teamName: benTeam.name,
        letter: nextLetter,
        kind: 'earned',
        totalWord: KEMP_LETTERS.slice(0, benTeam.letters).join(''),
      });
    } else {
      const opposing = activeTeams.filter((t) => t.index !== faultTeamIndex);
      if (opposing.length === 1) {
        const opp = opposing[0];
        const nextLetter = KEMP_LETTERS[opp.letters] || 'P';
        opp.letters = Math.min(4, opp.letters + 1);
        letterChanges.push({
          teamIndex: opp.index,
          teamName: opp.name,
          letter: nextLetter,
          kind: 'earned',
          totalWord: KEMP_LETTERS.slice(0, opp.letters).join(''),
        });
      } else {
        // Multi-team general blunder: avoid simultaneous match-win tie if >1 team would hit 4
        const wouldWinCount = opposing.filter((t) => t.letters + 1 >= 4).length;
        for (const opp of opposing) {
          const cap = wouldWinCount > 1 ? 3 : 4;
          if (opp.letters < cap) {
            const nextLetter = KEMP_LETTERS[opp.letters];
            opp.letters += 1;
            letterChanges.push({
              teamIndex: opp.index,
              teamName: opp.name,
              letter: nextLetter,
              kind: 'earned',
              totalWord: KEMP_LETTERS.slice(0, opp.letters).join(''),
            });
          }
        }
        // Also strip a letter from faultTeam if nobody could advance due to match-point tie guard
        if (letterChanges.length === 0 && room.teams[faultTeamIndex].letters > 0) {
          const fTeam = room.teams[faultTeamIndex];
          const lostLetter = KEMP_LETTERS[fTeam.letters - 1];
          fTeam.letters -= 1;
          letterChanges.push({
            teamIndex: fTeam.index,
            teamName: fTeam.name,
            letter: lostLetter,
            kind: 'stripped',
            totalWord: KEMP_LETTERS.slice(0, fTeam.letters).join(''),
          });
        }
      }
    }
  } else {
    // Penalty mode: faultTeam takes a penalty letter
    const fTeam = room.teams[faultTeamIndex];
    const nextLetter = KEMP_LETTERS[fTeam.letters] || 'P';
    fTeam.letters = Math.min(4, fTeam.letters + 1);
    if (fTeam.letters >= 4) fTeam.eliminated = true;
    letterChanges.push({
      teamIndex: fTeam.index,
      teamName: fTeam.name,
      letter: nextLetter,
      kind: 'penalty',
      eliminated: fTeam.eliminated,
      totalWord: KEMP_LETTERS.slice(0, fTeam.letters).join(''),
    });
  }

  return finalizeRound(room, { ...baseSummary, letterChanges });
}

function finalizeRound(room, summary) {
  room.activeTells.clear();
  room.flushVotes.clear();
  room.accusation = null;

  const revealedHands = {};
  for (const p of getActivePlayersIncludingJustEliminated(room)) {
    const evalRes = evaluateFourOfAKind(p.hand);
    revealedHands[p.id] = {
      playerId: p.id,
      playerName: p.name,
      teamIndex: p.teamIndex,
      cards: [...p.hand],
      fourOfAKind: evalRes.match,
      matchedRank: evalRes.rank,
    };
  }

  // Check match victory condition
  let winnerTeam = null;
  if (room.settings.kempScoringMode === 'earn') {
    const champ = room.teams.slice(0, room.settings.numTeams).find((t) => t.letters >= 4);
    if (champ) winnerTeam = champ.index;
  } else {
    const remaining = getActiveTeams(room);
    if (remaining.length === 1) {
      winnerTeam = remaining[0].index;
    }
  }

  for (const p of room.players.values()) {
    p.nextRoundReady = Boolean(p.isBot);
  }

  if (winnerTeam !== null) {
    room.phase = 'match_over';
    room.matchWinnerTeam = winnerTeam;
  } else {
    room.phase = 'round_over';
  }

  room.roundSummary = {
    ...summary,
    roundNumber: room.roundNumber,
    scoringMode: room.settings.kempScoringMode,
    revealedHands,
    matchWinnerTeam: winnerTeam,
    timestamp: Date.now(),
  };
  room.updatedAt = Date.now();
  return room.roundSummary;
}

function getActivePlayersIncludingJustEliminated(room) {
  const list = [];
  for (let t = 0; t < room.settings.numTeams; t++) {
    for (const pid of room.teams[t].seats) {
      if (pid) {
        const p = room.players.get(pid);
        if (p && p.hand.length > 0) list.push(p);
      }
    }
  }
  return list;
}

export function returnToLobby(room, actorId) {
  if (actorId !== room.hostId) {
    return { ok: false, message: 'Only the host can return the room to the lobby.' };
  }
  room.phase = 'lobby';
  room.roundNumber = 0;
  room.centerCards = [];
  room.deck = [];
  room.discardPile = [];
  room.flushVotes.clear();
  room.accusation = null;
  room.roundSummary = null;
  room.matchWinnerTeam = null;
  room.recentSwaps = [];
  room.activeTells.clear();
  for (let t = 0; t < 4; t++) {
    room.teams[t].letters = 0;
    room.teams[t].eliminated = false;
  }
  for (const p of room.players.values()) {
    p.hand = [];
    p.lastSwap = null;
    p.huddleReady = false;
    p.nextRoundReady = false;
  }
  room.updatedAt = Date.now();
  return { ok: true };
}

export function formatRankPlural(rank) {
  const names = {
    A: 'Aces',
    K: 'Kings',
    Q: 'Queens',
    J: 'Jacks',
    '10': '10s',
    '9': '9s',
    '8': '8s',
    '7': '7s',
    '6': '6s',
    '5': '5s',
    '4': '4s',
    '3': '3s',
    '2': '2s',
  };
  return names[rank] || `${rank}s`;
}

/**
 * Serialize personalized room state for a specific viewer so hidden hands & opponent huddles NEVER leak.
 */
export function serializeRoomForPlayer(room, viewerId) {
  const now = Date.now();
  const viewer = room.players.get(viewerId) || null;
  const showAllHands = room.phase === 'round_over' || room.phase === 'match_over';

  // Prune expired tells
  const visibleTells = [];
  for (const [pid, tell] of room.activeTells.entries()) {
    if (tell.expiresAt <= now) {
      room.activeTells.delete(pid);
    } else {
      visibleTells.push(tell);
    }
  }

  const playersList = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    connected: p.connected,
    teamIndex: p.teamIndex,
    seatIndex: p.seatIndex,
    cardCount: p.hand.length,
    huddleReady: p.huddleReady,
    nextRoundReady: p.nextRoundReady,
    flushVoted: room.flushVotes.has(p.id),
    lastSwapAt: p.lastSwapAt,
    lastSwap: p.lastSwap || null,
    // Only send actual card faces to the owner or during round_over/match_over reveal!
    hand: p.id === viewerId || showAllHands ? p.hand : null,
  }));

  let myHuddle = null;
  if (viewer && viewer.teamIndex !== null) {
    const huddle = room.teamHuddles.get(viewer.teamIndex);
    if (huddle) {
      myHuddle = {
        // Huddle chat messages ONLY accessible during huddle phase!
        messages: room.phase === 'huddle' ? huddle.messages : [],
        signalNote: huddle.signalNote,
        teamTellKey: huddle.teamTellKey || huddle.botTellKey || null,
        botTellKey: huddle.botTellKey,
      };
    }
  }

  return {
    code: room.code,
    serverNow: now,
    hostId: room.hostId,
    youId: viewerId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    settings: { ...room.settings },
    teams: room.teams.slice(0, room.settings.numTeams).map((t) => ({
      index: t.index,
      name: t.name,
      accent: t.accent,
      letters: t.letters,
      word: KEMP_LETTERS.slice(0, t.letters).join(''),
      eliminated: t.eliminated,
      seats: [...t.seats],
    })),
    players: playersList,
    centerCards: room.centerCards,
    recentSwaps: room.recentSwaps || [],
    deckRemaining: room.deck.length,
    discardCount: room.discardPile.length,
    flushVoteCount: room.flushVotes.size,
    activePlayerCount: getActivePlayers(room).length,
    flushCount: room.flushCount,
    countdownEndsAt: room.countdownEndsAt,
    huddleEndsAt: room.huddleEndsAt,
    accusation: room.accusation,
    lastAction: room.lastAction,
    activeTells: visibleTells,
    myHuddle,
    roundSummary: room.roundSummary,
    matchWinnerTeam: room.matchWinnerTeam,
  };
}
