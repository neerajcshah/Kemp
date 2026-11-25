import { soundFX } from './audio.js?v=20261125-3';
import { FIREBASE_CONFIG } from './firebaseConfig.js?v=20261125-3';
import {
  escapeHtml,
  renderPlayingCard,
  renderRulesModal,
  renderSelfKempConfirmModal,
  renderStage,
  renderTopBar,
} from './render.js?v=20261125-3';

const topbarEl = document.getElementById('topbar-root');
const stageEl = document.getElementById('stage-root');
const fxLayerEl = document.getElementById('fx-layer');
const modalRootEl = document.getElementById('modal-root');
const toastRootEl = document.getElementById('toast-root');

const urlParams = new URLSearchParams(window.location.search);
const prefillRoom = (urlParams.get('room') || '').trim().toUpperCase().slice(0, 4);

const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };

const ui = {
  savedName: localStorage.getItem('kemp_player_name') || '',
  xlMode: localStorage.getItem('kemp_xl_mode') === '1',
  prefillRoomCode: prefillRoom,
  tells: [],
  signalSuggestions: [],
  selectedHandCardId: null,
  selectedCenterIndex: null,
  selectedCenterCardId: null,
  peekingSignal: false,
  rulesOpen: false,
  confirmSelfKempOpen: false,
  serverClockSkew: 0,
  isMeetAddon: false,
};

document.documentElement.classList.toggle('xl-mode', ui.xlMode);

let roomState = null;
let ws = null;
let reconnectTimer = null;
let hadQuadInCurrentHand = false;
let dragState = null;
let suppressClickUntil = 0;

function myHandHasQuad(state = roomState) {
  const me = state?.players?.find((p) => p.id === state.youId);
  const hand = me?.hand || [];
  if (hand.length !== 4) return false;
  return hand.every((c) => c && c.rank === hand[0].rank);
}

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
  }, 3400);
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
  document.documentElement.classList.toggle('xl-mode', ui.xlMode);
  renderTopBar(topbarEl, roomState, ui);
  renderStage(stageEl, roomState, ui);

  if (ui.confirmSelfKempOpen && roomState?.phase === 'playing') {
    modalRootEl.innerHTML = renderSelfKempConfirmModal(roomState, ui);
  } else if (ui.rulesOpen) {
    modalRootEl.innerHTML = renderRulesModal();
  } else {
    modalRootEl.innerHTML = '';
  }

  // Re-apply active drag origin styling if UI refreshed mid-drag
  if (dragState?.dragging) {
    let origin = null;
    if (dragState.sourceZone === 'center') {
      origin = stageEl.querySelector(
        `[data-card-zone="center"][data-center-index="${dragState.centerIndex}"]`
      );
    } else if (dragState.sourceZone === 'hand') {
      origin = stageEl.querySelector(
        `[data-card-zone="hand"][data-card-id="${CSS.escape(dragState.cardId)}"]`
      );
    }
    if (origin) origin.classList.add('drag-origin');
  }

  // Auto-scroll huddle chat to bottom when in huddle
  if (roomState?.phase === 'huddle') {
    const chatLog = document.getElementById('huddle-chat-log');
    if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function captureSwapGeometryBeforeRender(evt, nextState) {
  if (!evt || evt.kind !== 'card_swapped' || !fxLayerEl) return null;
  const centerEl = stageEl.querySelector(
    `[data-card-zone="center"][data-center-index="${evt.centerIndex}"]`
  );
  if (!centerEl) return null;

  const centerRect = centerEl.getBoundingClientRect();
  let playerRect = null;
  const isMe = evt.playerId === nextState?.youId;

  if (isMe) {
    const handCardEl = evt.discarded?.id
      ? stageEl.querySelector(`[data-card-zone="hand"][data-card-id="${CSS.escape(evt.discarded.id)}"]`)
      : null;
    const handFallback = document.getElementById('my-hand-cards');
    const targetEl = handCardEl || handFallback;
    if (targetEl) playerRect = targetEl.getBoundingClientRect();
  } else {
    const seatEl = stageEl.querySelector(
      `[data-seat-player-id="${CSS.escape(String(evt.playerId || ''))}"]`
    );
    if (seatEl) playerRect = seatEl.getBoundingClientRect();
  }

  if (!playerRect) return null;
  return { centerRect, playerRect, isMe };
}

function spawnFlyingCard(card, tagText, fromX, fromY, toX, toY, endScale = 1) {
  if (!fxLayerEl || !card) return;
  const wrap = document.createElement('div');
  wrap.className = 'flying-swap-wrapper';
  wrap.innerHTML = `
    ${tagText ? `<span class="flying-swap-tag">${escapeHtml(tagText)}</span>` : ''}
    ${renderPlayingCard(card)}
  `;
  wrap.style.transform = `translate3d(${Math.round(fromX)}px, ${Math.round(fromY)}px, 0) scale(1)`;
  wrap.style.opacity = '1';
  fxLayerEl.appendChild(wrap);

  // Force layout so browser registers starting transform before animating
  wrap.getBoundingClientRect();

  requestAnimationFrame(() => {
    wrap.style.transform = `translate3d(${Math.round(toX)}px, ${Math.round(toY)}px, 0) scale(${endScale})`;
    wrap.style.opacity = endScale < 0.8 ? '0.92' : '1';
  });

  setTimeout(() => {
    wrap.style.opacity = '0';
  }, 540);

  setTimeout(() => {
    wrap.remove();
  }, 700);
}

function animateCardSwap(evt, geom, nextState) {
  if (!evt || !geom || !evt.pickedUp || !evt.discarded) return;
  const { centerRect, playerRect, isMe } = geom;
  const cardW = centerRect.width || 96;
  const cardH = centerRect.height || 138;

  const centerPos = {
    x: centerRect.left,
    y: centerRect.top,
  };

  const playerPos = isMe
    ? {
        x: playerRect.left + playerRect.width / 2 - cardW / 2,
        y: playerRect.top + playerRect.height / 2 - cardH / 2,
      }
    : {
        x: playerRect.left + playerRect.width / 2 - cardW / 2,
        y: playerRect.top + playerRect.height / 2 - cardH / 2,
      };

  const who = isMe ? 'You' : evt.playerName || 'Player';
  const pickedSym = SUIT_SYMBOLS[evt.pickedUp.suit] || evt.pickedUp.suit;
  const discSym = SUIT_SYMBOLS[evt.discarded.suit] || evt.discarded.suit;

  // 1. Center card flies to the player who grabbed it
  spawnFlyingCard(
    evt.pickedUp,
    `${who} took ${evt.pickedUp.rank}${pickedSym}`,
    centerPos.x,
    centerPos.y,
    playerPos.x,
    playerPos.y,
    isMe ? 0.98 : 0.58
  );

  // 2. Discarded card flies from that player into the center slot
  spawnFlyingCard(
    evt.discarded,
    `Left ${evt.discarded.rank}${discSym}`,
    playerPos.x,
    playerPos.y,
    centerPos.x,
    centerPos.y,
    1
  );
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
      cancelCardDrag();
      saveSessionAuth(null);
      roomState = null;
      hadQuadInCurrentHand = false;
      ui.selectedHandCardId = null;
      ui.selectedCenterIndex = null;
      ui.selectedCenterCardId = null;
      ui.confirmSelfKempOpen = false;
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('room');
      window.history.replaceState({}, '', cleanUrl.toString());
      refreshUI();
      break;
    }

    case 'room_state': {
      const prevPhase = roomState?.phase;
      let swapGeom = null;
      try {
        swapGeom = captureSwapGeometryBeforeRender(msg.event, msg.state);
      } catch {
        swapGeom = null;
      }

      roomState = msg.state;
      if (roomState.serverNow) {
        ui.serverClockSkew = Date.now() - roomState.serverNow;
      }

      // Clear stale selections if card left hand, center card changed, or phase changed
      const me = roomState.players.find((p) => p.id === roomState.youId);
      if (!me?.hand || !me.hand.some((c) => c.id === ui.selectedHandCardId)) {
        ui.selectedHandCardId = null;
      }
      if (
        ui.selectedCenterIndex !== null &&
        roomState.centerCards?.[ui.selectedCenterIndex]?.id !== ui.selectedCenterCardId
      ) {
        ui.selectedCenterIndex = null;
        ui.selectedCenterCardId = null;
      }
      // If dragging a center card that someone else just snatched, cancel drag immediately
      if (
        dragState?.sourceZone === 'center' &&
        dragState.centerIndex !== null &&
        roomState.centerCards?.[dragState.centerIndex]?.id !== dragState.cardId
      ) {
        cancelCardDrag();
      }

      if (roomState.phase !== 'playing') {
        cancelCardDrag();
        hadQuadInCurrentHand = false;
        ui.selectedHandCardId = null;
        ui.selectedCenterIndex = null;
        ui.selectedCenterCardId = null;
        ui.peekingSignal = false;
        ui.confirmSelfKempOpen = false;
      } else {
        const nowQuad = myHandHasQuad(roomState);
        if (nowQuad && !hadQuadInCurrentHand) {
          soundFX.quadReadyChime();
          const partner =
            me && me.teamIndex !== null
              ? roomState.players.find((p) => p.teamIndex === me.teamIndex && p.id !== me.id)
              : null;
          showToast(
            `🎉 4-OF-A-KIND! Press your glowing Signal Button so ${partner ? partner.name : 'your partner'} calls KEMP!`
          );
        }
        hadQuadInCurrentHand = nowQuad;
      }

      handleRoomAudioEvent(msg.event, prevPhase, roomState.phase);
      refreshUI();

      if (swapGeom && msg.event?.kind === 'card_swapped') {
        try {
          animateCardSwap(msg.event, swapGeom, roomState);
        } catch {
          // Ignore visual FX errors so state updates remain rock-solid
        }
      }
      break;
    }

    case 'swap_rejected': {
      soundFX.raceLost();
      ui.selectedCenterIndex = null;
      ui.selectedCenterCardId = null;
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
      const { createFirebaseTransport } = await import('./firebaseAdapter.js?v=20261125-3');
      fbTransport = await createFirebaseTransport(fbConfig, handleServerMessage);
      autoRejoinIfStored();
      return;
    }
  } catch (err) {
    console.error('Firebase initialization failed:', err);
  }

  // 3. Static host (e.g., GitHub Pages): run zero-cost WebRTC P2P + AI Bot multiplayer engine
  const { createLocalPracticeTransport } = await import('./firebaseAdapter.js?v=20261125-3');
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
    case 'table_tell':
      soundFX.tellPing();
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
  ui.selectedCenterCardId = null;

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
  soundFX.cardSnap();
  refreshUI();
}

function handleCenterCardSelect(centerIdx) {
  if (!roomState || roomState.phase !== 'playing') return;
  if (ui.selectedHandCardId) {
    attemptCardSwap(ui.selectedHandCardId, centerIdx);
    return;
  }
  if (ui.selectedCenterIndex === centerIdx) {
    ui.selectedCenterIndex = null;
    ui.selectedCenterCardId = null;
  } else {
    ui.selectedCenterIndex = centerIdx;
    ui.selectedCenterCardId = roomState.centerCards[centerIdx]?.id || null;
  }
  soundFX.cardSnap();
  refreshUI();
}

function handleKempButtonIntent() {
  if (!roomState || roomState.phase !== 'playing') return;
  if (myHandHasQuad(roomState)) {
    ui.confirmSelfKempOpen = true;
    refreshUI();
    return;
  }
  sendWs({ type: 'call_kemp' });
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

// ==========================================================================
// Pointer Drag-and-Drop Between Center Cards & Hand Cards (Mouse + Touch)
// ==========================================================================

function findDropTargetCard(clientX, clientY, targetZone) {
  const candidates = [...stageEl.querySelectorAll(`.playing-card.interactive[data-card-zone="${targetZone}"]`)];
  if (candidates.length === 0) return null;

  // Exact hit first
  const exact = document
    .elementFromPoint(clientX, clientY)
    ?.closest(`.playing-card.interactive[data-card-zone="${targetZone}"]`);
  if (exact) return exact;

  // Forgiving 26px proximity snap for older players / touchscreens
  const pad = 26;
  let best = null;
  let bestDist = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    ) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(clientX - cx, clientY - cy);
      if (d < bestDist) {
        bestDist = d;
        best = el;
      }
    }
  }
  return best;
}

function clearDropHoverHighlights() {
  stageEl.querySelectorAll('.playing-card.drop-hover').forEach((el) => {
    el.classList.remove('drop-hover');
  });
}

function cancelCardDrag() {
  if (!dragState) return;
  if (dragState.ghostEl) {
    dragState.ghostEl.remove();
  }
  stageEl.querySelectorAll('.playing-card.drag-origin').forEach((el) => {
    el.classList.remove('drag-origin');
  });
  clearDropHoverHighlights();
  dragState = null;
}

document.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('#peek-signal-btn')) {
    ui.peekingSignal = true;
    refreshUI();
    return;
  }

  if (ev.button !== undefined && ev.button !== 0) return;
  if (!roomState || roomState.phase !== 'playing') return;

  const cardEl = ev.target.closest('.playing-card.interactive[data-card-zone]');
  if (!cardEl) return;

  const rect = cardEl.getBoundingClientRect();
  dragState = {
    pointerId: ev.pointerId,
    sourceZone: cardEl.dataset.cardZone, // 'center' | 'hand'
    cardId: cardEl.dataset.cardId || '',
    centerIndex: cardEl.dataset.centerIndex !== undefined ? Number(cardEl.dataset.centerIndex) : null,
    startX: ev.clientX,
    startY: ev.clientY,
    offsetX: ev.clientX - rect.left,
    offsetY: ev.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    cardHtml: cardEl.outerHTML,
    dragging: false,
    ghostEl: null,
  };
});

window.addEventListener('pointermove', (ev) => {
  if (!dragState || ev.pointerId !== dragState.pointerId) return;

  const dx = ev.clientX - dragState.startX;
  const dy = ev.clientY - dragState.startY;

  if (!dragState.dragging) {
    if (Math.hypot(dx, dy) < 7) return;
    dragState.dragging = true;

    if (fxLayerEl) {
      const temp = document.createElement('div');
      temp.innerHTML = dragState.cardHtml.trim();
      const ghost = temp.firstElementChild;
      if (ghost) {
        ghost.classList.remove('selected', 'swap-target-ready');
        ghost.classList.add('drag-ghost-card');
        ghost.style.width = `${dragState.width}px`;
        ghost.style.height = `${dragState.height}px`;
        fxLayerEl.appendChild(ghost);
        dragState.ghostEl = ghost;
      }
    }

    const originSelector =
      dragState.sourceZone === 'center'
        ? `[data-card-zone="center"][data-center-index="${dragState.centerIndex}"]`
        : `[data-card-zone="hand"][data-card-id="${CSS.escape(dragState.cardId)}"]`;
    stageEl.querySelector(originSelector)?.classList.add('drag-origin');
  }

  if (dragState.ghostEl) {
    const gx = Math.round(ev.clientX - dragState.offsetX);
    const gy = Math.round(ev.clientY - dragState.offsetY);
    dragState.ghostEl.style.transform = `translate3d(${gx}px, ${gy}px, 0) rotate(3deg) scale(1.05)`;
  }

  clearDropHoverHighlights();
  const oppositeZone = dragState.sourceZone === 'center' ? 'hand' : 'center';
  const dropTarget = findDropTargetCard(ev.clientX, ev.clientY, oppositeZone);
  if (dropTarget) {
    dropTarget.classList.add('drop-hover');
  }
});

function finishPointerInteraction(ev) {
  stopPeekingSignal();
  if (!dragState || ev.pointerId !== dragState.pointerId) return;

  if (dragState.dragging) {
    suppressClickUntil = Date.now() + 260;
    const oppositeZone = dragState.sourceZone === 'center' ? 'hand' : 'center';
    const dropTarget = findDropTargetCard(ev.clientX, ev.clientY, oppositeZone);

    const srcZone = dragState.sourceZone;
    const srcCardId = dragState.cardId;
    const srcCenterIdx = dragState.centerIndex;
    cancelCardDrag();

    if (dropTarget) {
      if (srcZone === 'center' && srcCenterIdx !== null) {
        attemptCardSwap(dropTarget.dataset.cardId, srcCenterIdx);
      } else if (srcZone === 'hand') {
        attemptCardSwap(srcCardId, Number(dropTarget.dataset.centerIndex));
      }
    }
    return;
  }

  dragState = null;
}

window.addEventListener('pointerup', finishPointerInteraction);
window.addEventListener('pointercancel', () => {
  stopPeekingSignal();
  cancelCardDrag();
});

// Delegated Click Handling
document.addEventListener('click', (ev) => {
  if (Date.now() < suppressClickUntil) {
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }

  const target = ev.target.closest('button, a, [data-card-zone]');
  if (!target) return;

  if (target.id === 'brand-home-link' && roomState) {
    ev.preventDefault();
    return;
  }

  // Top bar actions
  if (target.id === 'toggle-xl-btn') {
    ui.xlMode = !ui.xlMode;
    localStorage.setItem('kemp_xl_mode', ui.xlMode ? '1' : '0');
    soundFX.cardSnap();
    refreshUI();
    return;
  }

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

  // Self-Kemp Misclick Protection Modal Actions
  if (target.id === 'cancel-self-kemp-btn') {
    ui.confirmSelfKempOpen = false;
    refreshUI();
    return;
  }

  if (target.id === 'confirm-send-signal-instead-btn') {
    const tellKey = target.dataset.tell || 'tap';
    ui.confirmSelfKempOpen = false;
    sendWs({ type: 'table_tell', tellKey });
    showToast('Sent secret signal to your partner!');
    refreshUI();
    return;
  }

  if (target.id === 'force-call-kemp-btn') {
    ui.confirmSelfKempOpen = false;
    sendWs({ type: 'call_kemp' });
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
  if (action === 'pick-team-tell') {
    soundFX.cardSnap();
    sendWs({ type: 'huddle_tell_key', tellKey: target.dataset.tell });
    return;
  }

  if (target.id === 'save-signal-btn') {
    const sigInput = document.getElementById('signal-note-input');
    if (sigInput) {
      sendWs({ type: 'huddle_signal', signalNote: sigInput.value });
      showToast('Pinned secret signal note for your team!');
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
    handleKempButtonIntent();
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

// Close modals when clicking backdrop
modalRootEl.addEventListener('click', (ev) => {
  if (ev.target.id === 'rules-modal-backdrop') {
    ui.rulesOpen = false;
    refreshUI();
  } else if (ev.target.id === 'self-kemp-backdrop') {
    ui.confirmSelfKempOpen = false;
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
    if (ui.confirmSelfKempOpen) {
      ui.confirmSelfKempOpen = false;
      refreshUI();
      return;
    }
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
    handleKempButtonIntent();
    return;
  }

  if (lower === 'n') {
    ev.preventDefault();
    sendWs({ type: 'call_not_kemp' });
  }
});

function stopPeekingSignal() {
  if (ui.peekingSignal) {
    ui.peekingSignal = false;
    refreshUI();
  }
}
window.addEventListener('blur', () => {
  stopPeekingSignal();
  cancelCardDrag();
});

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
