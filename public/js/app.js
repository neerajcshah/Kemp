import { soundFX } from './audio.js';
import { FIREBASE_CONFIG } from './firebaseConfig.js';
import { renderRulesModal, renderStage, renderTopBar } from './render.js';

const topbarEl = document.getElementById('topbar-root');
const stageEl = document.getElementById('stage-root');
const modalRootEl = document.getElementById('modal-root');
const toastRootEl = document.getElementById('toast-root');

const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = (urlParams.get('room') || '').trim().toUpperCase().slice(0, 4);

const ui = {
  savedName: localStorage.getItem('kemp_player_name') || '',
  prefillRoomCode: prefillRoom,
  tells: [],
  signalSuggestions: [],
  selectedHandCardId: null,
  selectedCenterIndex: null,
  peekingSignal: false,
  rulesOpen: false,
  serverClockSkew: 0,
  isMeetAddon: false,
};

let roomState = null;
let ws = null;
let reconnectTimer = null;

function getSessionAuth() {
  try {
    const raw = sessionStorage.getItem('kemp_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSessionAuth(data) {
  try {
    if (!data) sessionStorage.removeItem('kemp_session');
    else sessionStorage.setItem('kemp_session', JSON.stringify(data));
  } catch {
    // Ignore storage quota issues
  }
}

function showToast(message, kind = 'info') {
  const item = document.createElement('div');
  item.className = `toast-item ${kind === 'warn' ? 'warn' : ''}`;
  item.textContent = message;
  toastRootEl.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, 3100);
}

let fbTransport = null;

function sendWs(payload) {
  if (fbTransport) {
    fbTransport.send(payload);
    return;
  }
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  } else {
    showToast('Reconnecting to game server…', 'warn');
  }
}

function refreshUI() {
  renderTopBar(topbarEl, roomState, ui);
  renderStage(stageEl, roomState, ui);
  modalRootEl.innerHTML = ui.rulesOpen ? renderRulesModal() : '';

  // Auto-scroll huddle chat to bottom when in huddle
  if (roomState?.phase === 'huddle') {
    const chatLog = document.getElementById('huddle-chat-log');
    if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'welcome': {
      ui.tells = msg.tells || [];
      ui.signalSuggestions = msg.signalSuggestions || [];
      refreshUI();
      break;
    }

    case 'joined': {
      saveSessionAuth({
        roomCode: msg.roomCode,
        playerId: msg.playerId,
        token: msg.token,
        name: ui.savedName,
      });
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('room', msg.roomCode);
      window.history.replaceState({}, '', nextUrl.toString());
      break;
    }

    case 'left_room': {
      saveSessionAuth(null);
      roomState = null;
      ui.selectedHandCardId = null;
      ui.selectedCenterIndex = null;
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('room');
      window.history.replaceState({}, '', cleanUrl.toString());
      refreshUI();
      break;
    }

    case 'room_state': {
      const prevPhase = roomState?.phase;
      roomState = msg.state;
      if (roomState.serverNow) {
        ui.serverClockSkew = Date.now() - roomState.serverNow;
      }

      // Clear stale selections if card left hand or phase changed
      const me = roomState.players.find((p) => p.id === roomState.youId);
      if (!me?.hand || !me.hand.some((c) => c.id === ui.selectedHandCardId)) {
        ui.selectedHandCardId = null;
      }
      if (roomState.phase !== 'playing') {
        ui.selectedHandCardId = null;
        ui.selectedCenterIndex = null;
        ui.peekingSignal = false;
      }

      handleRoomAudioEvent(msg.event, prevPhase, roomState.phase);
      refreshUI();
      break;
    }

    case 'swap_rejected': {
      soundFX.raceLost();
      ui.selectedCenterIndex = null;
      showToast(msg.message || 'Card was snatched first!', 'warn');
      refreshUI();
      break;
    }

    case 'toast': {
      showToast(msg.message, msg.kind || 'info');
      break;
    }

    case 'error': {
      if (msg.code === 'ROOM_NOT_FOUND') {
        saveSessionAuth(null);
      }
      showToast(msg.message || 'Something went wrong.', 'warn');
      break;
    }
  }
}

function autoRejoinIfStored() {
  const existing = getSessionAuth();
  if (existing?.roomCode && existing?.token && (!prefillRoom || prefillRoom === existing.roomCode)) {
    sendWs({
      type: 'join_room',
      code: existing.roomCode,
      token: existing.token,
      name: ui.savedName || existing.name || 'Player',
    });
  }
}

function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const wsUrl = new URL('./ws', window.location.href);
  wsUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  wsUrl.search = '';
  ws = new WebSocket(wsUrl.toString());

  ws.addEventListener('open', () => {
    autoRejoinIfStored();
  });

  ws.addEventListener('message', (ev) => {
    try {
      handleServerMessage(JSON.parse(ev.data));
    } catch {
      // Ignore malformed payloads
    }
  });

  ws.addEventListener('close', () => {
    reconnectTimer = setTimeout(connectWebSocket, 1600);
  });
}

async function initBackendTransport() {
  // 1. Check if Cloud Run / Node.js WebSocket server is active
  try {
    const res = await fetch('./api/meta', { cache: 'no-store' });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      connectWebSocket();
      return;
    }
  } catch {
    // Fall through to Firebase Spark Hosting check
  }

  // 2. Check for Firebase Spark Plan auto-configuration (/__/firebase/init.json on *.web.app)
  try {
    let fbConfig = FIREBASE_CONFIG || window.KEMP_FIREBASE_CONFIG || null;
    if (!fbConfig) {
      const initRes = await fetch('/__/firebase/init.json', { cache: 'no-store' });
      const ct = initRes.headers.get('content-type') || '';
      if (initRes.ok && ct.includes('application/json')) {
        fbConfig = await initRes.json();
      }
    }
    if (fbConfig?.apiKey) {
      const { createFirebaseTransport } = await import('./firebaseAdapter.js');
      fbTransport = await createFirebaseTransport(fbConfig, handleServerMessage);
      autoRejoinIfStored();
      return;
    }
  } catch (err) {
    console.error('Firebase initialization failed:', err);
  }

  // 3. Static host (e.g., GitHub Pages before FIREBASE_CONFIG is pasted): run in-browser practice & multi-tab engine
  const { createLocalPracticeTransport } = await import('./firebaseAdapter.js');
  fbTransport = createLocalPracticeTransport(handleServerMessage);
  autoRejoinIfStored();
}

function handleRoomAudioEvent(event, prevPhase, nextPhase) {
  if (!event) {
    if (prevPhase === 'countdown' && nextPhase === 'playing') {
      soundFX.dealSweep();
    }
    return;
  }
  switch (event.kind) {
    case 'cards_dealt':
    case 'center_flushed':
      soundFX.dealSweep();
      break;
    case 'card_swapped':
      soundFX.cardSnap();
      break;
    case 'freeze_not_kemp':
      soundFX.freezeAlarm();
      break;
    case 'showdown':
      if (event.success) soundFX.victoryChord();
      else soundFX.blunderBuzz();
      break;
  }
}

function readAndPersistPlayerName() {
  const nameInput = document.getElementById('player-name-input');
  const raw = nameInput ? nameInput.value.trim() : ui.savedName.trim();
  const finalName = raw || 'Player';
  ui.savedName = finalName;
  localStorage.setItem('kemp_player_name', finalName);
  return finalName;
}

function attemptCardSwap(handCardId, centerIndex) {
  if (!roomState || roomState.phase !== 'playing') return;
  const centerCard = roomState.centerCards[centerIndex];
  if (!centerCard) return;

  ui.selectedHandCardId = null;
  ui.selectedCenterIndex = null;

  sendWs({
    type: 'swap_card',
    handCardId,
    centerIndex,
    expectedCenterCardId: centerCard.id,
  });
}

function handleHandCardSelect(cardId) {
  if (!roomState || roomState.phase !== 'playing') return;
  if (ui.selectedCenterIndex !== null) {
    attemptCardSwap(cardId, ui.selectedCenterIndex);
    return;
  }
  ui.selectedHandCardId = ui.selectedHandCardId === cardId ? null : cardId;
  refreshUI();
}

function handleCenterCardSelect(centerIdx) {
  if (!roomState || roomState.phase !== 'playing') return;
  if (ui.selectedHandCardId) {
    attemptCardSwap(ui.selectedHandCardId, centerIdx);
    return;
  }
  ui.selectedCenterIndex = ui.selectedCenterIndex === centerIdx ? null : centerIdx;
  refreshUI();
}

function copyRoomInvite() {
  if (!roomState?.code) return;
  const url = new URL(window.location.href);
  url.searchParams.set('room', roomState.code);
  const inviteUrl = url.toString();
  navigator.clipboard
    ?.writeText(inviteUrl)
    .then(() => showToast(`Copied invite link for Room ${roomState.code}!`))
    .catch(() => showToast(`Room Code: ${roomState.code}`));
}

// Delegated Click Handling
document.addEventListener('click', (ev) => {
  const target = ev.target.closest('button, a, [data-card-zone]');
  if (!target) return;

  if (target.id === 'brand-home-link' && roomState) {
    ev.preventDefault();
    return;
  }

  // Top bar actions
  if (target.id === 'toggle-sound-btn') {
    const muted = soundFX.toggleMute();
    if (!muted) soundFX.cardSnap();
    refreshUI();
    return;
  }

  if (target.id === 'open-rules-btn') {
    ui.rulesOpen = true;
    refreshUI();
    return;
  }

  if (target.id === 'close-rules-btn') {
    ui.rulesOpen = false;
    refreshUI();
    return;
  }

  if (target.id === 'copy-room-btn' || target.id === 'copy-invite-lobby-btn') {
    copyRoomInvite();
    return;
  }

  if (target.id === 'quick-set-meet-btn') {
    const pasted = window.prompt(
      'Paste your Google Meet URL (e.g., https://meet.google.com/abc-defg-hij):',
      roomState?.settings?.meetUrl || ''
    );
    if (pasted !== null) {
      sendWs({ type: 'update_settings', settings: { meetUrl: pasted } });
    }
    return;
  }

  if (target.id === 'leave-room-btn') {
    sendWs({ type: 'leave_room' });
    return;
  }

  // Landing screen actions
  if (target.id === 'create-room-btn') {
    const name = readAndPersistPlayerName();
    sendWs({ type: 'create_room', name, quickDemo: false });
    return;
  }

  if (target.id === 'quick-demo-btn') {
    const name = readAndPersistPlayerName();
    sendWs({ type: 'create_room', name, quickDemo: true });
    return;
  }

  if (target.id === 'join-room-btn') {
    const name = readAndPersistPlayerName();
    const codeEl = document.getElementById('join-code-input');
    const code = (codeEl?.value || '').trim().toUpperCase();
    if (code.length < 4) {
      showToast('Enter a 4-letter room code to join.', 'warn');
      codeEl?.focus();
      return;
    }
    const existing = getSessionAuth();
    sendWs({
      type: 'join_room',
      code,
      name,
      token: existing?.roomCode === code ? existing.token : undefined,
    });
    return;
  }

  // Lobby actions
  if (target.id === 'fill-bots-btn') {
    sendWs({ type: 'fill_bots' });
    return;
  }

  if (target.id === 'save-meet-btn') {
    const meetInput = document.getElementById('meet-url-input');
    sendWs({
      type: 'update_settings',
      settings: { meetUrl: meetInput ? meetInput.value : '' },
    });
    showToast('Updated Google Meet link for the room!');
    return;
  }

  if (target.id === 'start-match-btn') {
    sendWs({ type: 'start_match' });
    return;
  }

  if (target.dataset.setting) {
    const key = target.dataset.setting;
    const rawVal = target.dataset.value;
    const val = key === 'numTeams' || key === 'huddleSeconds' ? Number(rawVal) : rawVal;
    sendWs({ type: 'update_settings', settings: { [key]: val } });
    return;
  }

  const action = target.dataset.action;
  if (action === 'select-seat') {
    sendWs({
      type: 'select_seat',
      teamIndex: Number(target.dataset.team),
      seatIndex: Number(target.dataset.seat),
    });
    return;
  }

  if (action === 'add-bot') {
    sendWs({
      type: 'add_bot',
      teamIndex: Number(target.dataset.team),
      seatIndex: Number(target.dataset.seat),
    });
    return;
  }

  if (action === 'remove-player') {
    sendWs({
      type: 'remove_player',
      targetId: target.dataset.playerId,
    });
    return;
  }

  // Huddle actions
  if (target.id === 'save-signal-btn') {
    const sigInput = document.getElementById('signal-note-input');
    if (sigInput) {
      sendWs({ type: 'huddle_signal', signalNote: sigInput.value });
      showToast('Pinned secret signal for your team!');
    }
    return;
  }

  if (action === 'use-signal-chip') {
    const sig = target.dataset.signal || '';
    const sigInput = document.getElementById('signal-note-input');
    if (sigInput) sigInput.value = sig;
    sendWs({ type: 'huddle_signal', signalNote: sig });
    return;
  }

  if (target.id === 'huddle-ready-btn') {
    const sigInput = document.getElementById('signal-note-input');
    if (sigInput && sigInput.value.trim() !== (roomState?.myHuddle?.signalNote || '')) {
      sendWs({ type: 'huddle_signal', signalNote: sigInput.value });
    }
    sendWs({ type: 'huddle_ready' });
    return;
  }

  // Live Table actions
  if (target.dataset.cardZone === 'hand') {
    handleHandCardSelect(target.dataset.cardId);
    return;
  }

  if (target.dataset.cardZone === 'center') {
    handleCenterCardSelect(Number(target.dataset.centerIndex));
    return;
  }

  if (target.id === 'vote-flush-btn') {
    sendWs({ type: 'toggle_flush' });
    return;
  }

  if (action === 'send-tell') {
    sendWs({ type: 'table_tell', tellKey: target.dataset.tell });
    return;
  }

  if (target.id === 'call-kemp-btn') {
    sendWs({ type: 'call_kemp' });
    return;
  }

  if (target.id === 'call-not-kemp-btn') {
    sendWs({ type: 'call_not_kemp' });
    return;
  }

  if (action === 'accuse-opponent') {
    sendWs({ type: 'call_not_kemp', targetPlayerId: target.dataset.targetId });
    return;
  }

  // Post-round / rematch actions
  if (target.id === 'next-round-btn') {
    sendWs({ type: 'next_round' });
    return;
  }

  if (target.id === 'play-again-btn') {
    sendWs({ type: 'start_match' });
    return;
  }

  if (target.id === 'return-lobby-btn') {
    sendWs({ type: 'return_lobby' });
  }
});

// Close rules modal when clicking backdrop
modalRootEl.addEventListener('click', (ev) => {
  if (ev.target.id === 'rules-modal-backdrop') {
    ui.rulesOpen = false;
    refreshUI();
  }
});

// Form Submissions (Huddle Chat & Enter key on Join Code)
document.addEventListener('submit', (ev) => {
  if (ev.target.id === 'huddle-chat-form') {
    ev.preventDefault();
    const input = document.getElementById('huddle-chat-input');
    const text = input?.value.trim();
    if (!text) return;
    input.value = '';
    sendWs({ type: 'huddle_message', text });
  }
});

document.addEventListener('keydown', (ev) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (ev.key === 'Enter' && document.activeElement.id === 'join-code-input') {
      ev.preventDefault();
      document.getElementById('join-room-btn')?.click();
    }
    return;
  }

  if (ev.key === 'Escape') {
    if (ui.rulesOpen) {
      ui.rulesOpen = false;
      refreshUI();
      return;
    }
    if (ui.selectedHandCardId || ui.selectedCenterIndex !== null) {
      ui.selectedHandCardId = null;
      ui.selectedCenterIndex = null;
      refreshUI();
    }
    return;
  }

  if (!roomState || roomState.phase !== 'playing') return;
  const me = roomState.players.find((p) => p.id === roomState.youId);
  const hand = me?.hand || [];

  const lower = ev.key.toLowerCase();
  if (['1', '2', '3', '4'].includes(lower)) {
    const idx = Number(lower) - 1;
    if (hand[idx]) {
      ev.preventDefault();
      handleHandCardSelect(hand[idx].id);
    }
    return;
  }

  const centerKeyMap = { q: 0, w: 1, e: 2, r: 3 };
  if (lower in centerKeyMap) {
    const cIdx = centerKeyMap[lower];
    if (roomState.centerCards[cIdx]) {
      ev.preventDefault();
      handleCenterCardSelect(cIdx);
    }
    return;
  }

  if (ev.code === 'Space') {
    ev.preventDefault();
    sendWs({ type: 'toggle_flush' });
    return;
  }

  if (lower === 'k') {
    ev.preventDefault();
    sendWs({ type: 'call_kemp' });
    return;
  }

  if (lower === 'n') {
    ev.preventDefault();
    sendWs({ type: 'call_not_kemp' });
  }
});

// Hold-to-peek secret signal reminder
document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('#peek-signal-btn')) {
    ui.peekingSignal = true;
    refreshUI();
  }
});

function stopPeekingSignal() {
  if (ui.peekingSignal) {
    ui.peekingSignal = false;
    refreshUI();
  }
}
window.addEventListener('pointerup', stopPeekingSignal);
window.addEventListener('blur', stopPeekingSignal);

// Smooth countdown / shot-clock UI refresh
setInterval(() => {
  if (!roomState) return;
  if (
    roomState.phase === 'countdown' ||
    (roomState.phase === 'huddle' && roomState.huddleEndsAt > 0) ||
    roomState.phase === 'accusing' ||
    (roomState.activeTells && roomState.activeTells.length > 0)
  ) {
    // Prune locally expired tells so UI cleans up crisply
    if (roomState.activeTells?.length) {
      const approxServerNow = Date.now() - ui.serverClockSkew;
      roomState.activeTells = roomState.activeTells.filter((t) => t.expiresAt > approxServerNow);
    }
    refreshUI();
  }
}, 250);

// Optional Google Meet Add-ons SDK initialization when embedded inside Google Meet
async function initGoogleMeetAddonIfPresent() {
  if (!urlParams.has('meet_sdk') || !window.meet?.addon) return;
  try {
    const cloudProjectNumber = urlParams.get('gcp_project') || window.KEMP_GCP_PROJECT_NUMBER || '';
    if (!cloudProjectNumber) return;
    const session = await window.meet.addon.createAddonSession({
      cloudProjectNumber,
    });
    if (urlParams.get('surface') === 'sidepanel') {
      await session.createSidePanelClient();
    } else {
      await session.createMainStageClient();
    }
    ui.isMeetAddon = true;
    refreshUI();
  } catch {
    // Running standalone outside Meet iframe
  }
}

refreshUI();
initBackendTransport();
initGoogleMeetAddonIfPresent();
