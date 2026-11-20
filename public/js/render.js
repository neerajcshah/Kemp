import { soundFX } from './audio.js';

const SUIT_SYMBOLS = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const KEMP_LETTERS = ['K', 'E', 'M', 'P'];
const HAND_KEYS = ['1', '2', '3', '4'];
const CENTER_KEYS = ['Q', 'W', 'E', 'R'];

export function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderPlayingCard(card, opts = {}) {
  const isRed = card.suit === 'H' || card.suit === 'D';
  const symbol = SUIT_SYMBOLS[card.suit] || card.suit;
  const classes = [
    'playing-card',
    isRed ? 'suit-red' : 'suit-black',
    opts.interactive ? 'interactive' : '',
    opts.selected ? 'selected' : '',
    opts.swapReady ? 'swap-target-ready' : '',
    opts.quadGlow ? 'quad-glow' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const attrs = opts.dataAttrs || '';
  const kbd = opts.kbd ? `<span class="kbd-badge">${escapeHtml(opts.kbd)}</span>` : '';

  return `
    <div class="${classes}" ${attrs} role="${opts.interactive ? 'button' : 'img'}" tabindex="${opts.interactive ? '0' : '-1'}" aria-label="${escapeHtml(card.rank)} of ${escapeHtml(card.suit)}">
      ${kbd}
      <div class="card-corner top">
        <span class="card-rank">${escapeHtml(card.rank)}</span>
        <span class="card-suit-sm">${symbol}</span>
      </div>
      <div class="card-pip-center">${symbol}</div>
      <div class="card-corner bottom">
        <span class="card-rank">${escapeHtml(card.rank)}</span>
        <span class="card-suit-sm">${symbol}</span>
      </div>
    </div>
  `;
}

export function renderTopBar(container, state, ui) {
  const inRoom = Boolean(state && state.code);
  const isHost = inRoom && state.hostId === state.youId;
  const meetUrl = state?.settings?.meetUrl || '';

  container.innerHTML = `
    <div class="brand-group">
      <a href="./" class="brand-mark" id="brand-home-link">
        <span>KEMP</span>
        <span class="brand-suits" aria-hidden="true">♠♥♦♣</span>
      </a>
      ${
        inRoom
          ? `<button type="button" class="room-chip" id="copy-room-btn" title="Copy room invite link">
               <span class="material-symbols-rounded" style="font-size:16px">content_copy</span>
               <span>ROOM ${escapeHtml(state.code)}</span>
             </button>`
          : ''
      }
      ${
        ui.isMeetAddon
          ? `<span class="room-chip" style="border-color:hsla(146,58%,48%,0.4);color:hsl(146,65%,75%)">
               <span class="material-symbols-rounded" style="font-size:15px">videocam</span>
               <span>Inside Meet</span>
             </span>`
          : ''
      }
    </div>

    <div class="topbar-actions">
      ${
        inRoom && meetUrl && !ui.isMeetAddon
          ? `<a href="${escapeHtml(meetUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-meet" id="join-meet-top-btn">
               <span class="material-symbols-rounded">videocam</span>
               <span>Join Google Meet</span>
             </a>`
          : ''
      }
      ${
        inRoom && !meetUrl && isHost && state.phase !== 'lobby' && !ui.isMeetAddon
          ? `<button type="button" class="btn btn-secondary btn-sm" id="quick-set-meet-btn">
               <span class="material-symbols-rounded">video_call</span>
               <span>Link Google Meet</span>
             </button>`
          : ''
      }
      <button type="button" class="btn btn-ghost btn-sm" id="toggle-sound-btn" title="Toggle sound effects">
        <span class="material-symbols-rounded">${soundFX.muted ? 'volume_off' : 'volume_up'}</span>
      </button>
      <button type="button" class="btn btn-ghost btn-sm" id="open-rules-btn">
        <span class="material-symbols-rounded">menu_book</span>
        <span>Rules</span>
      </button>
      ${
        inRoom
          ? `<button type="button" class="btn btn-ghost btn-sm" id="leave-room-btn">
               <span class="material-symbols-rounded">logout</span>
               <span>Leave</span>
             </button>`
          : ''
      }
    </div>
  `;
}

export function renderStage(container, state, ui) {
  // Preserve focused input state so real-time updates never wipe typing
  const activeEl = document.activeElement;
  let preservedFocus = null;
  if (activeEl && activeEl.id && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
    preservedFocus = {
      id: activeEl.id,
      value: activeEl.value,
      start: activeEl.selectionStart,
      end: activeEl.selectionEnd,
    };
  }

  if (!state) {
    container.innerHTML = renderLandingView(ui);
  } else if (state.phase === 'lobby') {
    container.innerHTML = renderLobbyView(state, ui);
  } else if (state.phase === 'huddle') {
    container.innerHTML = renderHuddleView(state, ui);
  } else {
    container.innerHTML = renderTableArenaView(state, ui);
  }

  if (preservedFocus) {
    const nextEl = document.getElementById(preservedFocus.id);
    if (nextEl) {
      nextEl.value = preservedFocus.value;
      nextEl.focus();
      try {
        if (preservedFocus.start !== null) {
          nextEl.setSelectionRange(preservedFocus.start, preservedFocus.end);
        }
      } catch {
        // Ignore selection range on unsupported input types
      }
    }
  }
}

function renderLandingView(ui) {
  const demoHand = [
    { id: 'AS', rank: 'A', suit: 'S' },
    { id: 'AH', rank: 'A', suit: 'H' },
    { id: 'AD', rank: 'A', suit: 'D' },
    { id: 'AC', rank: 'A', suit: 'C' },
  ];

  return `
    <section class="landing-wrap">
      <div class="hero-copy">
        <div class="hero-cards-fan" aria-hidden="true">
          ${demoHand.map((c) => renderPlayingCard(c)).join('')}
        </div>
        <h1>Secret Signals.<br>Four of a Kind.</h1>
        <p>
          Play the fast-paced partnership card game <strong>Kemp</strong> alongside Google Meet.
          Agree on a secret signal in your private pre-round huddle, race for center cards, get your partner to yell
          <strong>Kemp!</strong> — or catch the other team with <strong>Not Kemp!</strong>
        </p>
        <div class="how-steps">
          <div class="how-step">
            <span class="how-step-num">1.</span>
            <span>Hop on a free <strong>Google Meet</strong> call so everyone can see faces and banter.</span>
          </div>
          <div class="how-step">
            <span class="how-step-num">2.</span>
            <span>Use the <strong>Partner Secret Huddle</strong> before each deal to pick your signal (auto-locks during play).</span>
          </div>
          <div class="how-step">
            <span class="how-step-num">3.</span>
            <span>Swap simultaneously with the 4 center cards to collect 4-of-a-kind and spell <strong>K-E-M-P</strong>.</span>
          </div>
        </div>
      </div>

      <div class="entry-card">
        <h2>Take a Seat at the Table</h2>

        <div class="field-group">
          <label class="field-label" for="player-name-input">Your Display Name</label>
          <input
            id="player-name-input"
            class="input-field"
            type="text"
            maxlength="22"
            placeholder="e.g., Neeraj"
            value="${escapeHtml(ui.savedName || '')}"
          />
        </div>

        <div class="field-group">
          <label class="field-label" for="join-code-input">Have a 4-Letter Room Code?</label>
          <div class="join-row">
            <input
              id="join-code-input"
              class="input-field code-input"
              type="text"
              maxlength="4"
              placeholder="ABCD"
              value="${escapeHtml(ui.prefillRoomCode || '')}"
            />
            <button type="button" class="btn btn-primary" id="join-room-btn">
              <span>Join Table</span>
            </button>
          </div>
        </div>

        <div class="entry-divider">or start a new room</div>

        <div class="entry-actions-stack">
          <button type="button" class="btn btn-primary" id="create-room-btn" style="width:100%">
            <span class="material-symbols-rounded">playing_cards</span>
            <span>Create Private Room</span>
          </button>
          <button type="button" class="btn btn-secondary" id="quick-demo-btn" style="width:100%">
            <span class="material-symbols-rounded">smart_toy</span>
            <span>Instant 2v2 Practice with Bots</span>
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderScoreboardStrip(state) {
  const tileClass = state.settings.kempScoringMode === 'penalty' ? 'filled-penalty' : 'filled-earn';
  const modeNote =
    state.settings.kempScoringMode === 'penalty'
      ? 'Penalty Mode (Avoid K-E-M-P)'
      : 'First to Spell K-E-M-P Wins';

  return `
    <div class="scoreboard-bar" aria-label="Match Scoreboard — ${escapeHtml(modeNote)}">
      ${state.teams
        .map((team) => {
          const tiles = KEMP_LETTERS.map((letter, idx) => {
            const filled = idx < team.letters;
            return `<span class="kemp-tile ${filled ? tileClass : ''}">${letter}</span>`;
          }).join('');
          return `
            <div class="team-score-pill ${team.eliminated ? 'eliminated' : ''}">
              <span class="team-dot dot-${escapeHtml(team.accent)}"></span>
              <span class="team-score-name">${escapeHtml(team.name)}</span>
              <div class="kemp-tiles">${tiles}</div>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderLobbyView(state, ui) {
  const isHost = state.hostId === state.youId;
  const playersById = new Map(state.players.map((p) => [p.id, p]));
  const totalSeats = state.settings.numTeams * 2;
  const filledSeats = state.teams.reduce(
    (acc, t) => acc + t.seats.filter(Boolean).length,
    0
  );
  const allFilled = filledSeats === totalSeats;

  return `
    <section class="lobby-grid">
      <div class="panel-box">
        <div class="panel-header">
          <div>
            <h1 class="panel-title">Room ${escapeHtml(state.code)} — Choose Partners</h1>
            <div class="setting-hint">${filledSeats}/${totalSeats} seats filled · Share room code or invite link in Google Meet</div>
          </div>
          ${
            isHost && !allFilled
              ? `<button type="button" class="btn btn-secondary btn-sm" id="fill-bots-btn">
                   <span class="material-symbols-rounded">smart_toy</span>
                   <span>Fill Empty with Bots</span>
                 </button>`
              : ''
          }
        </div>

        <div class="teams-seats-grid">
          ${state.teams
            .map((team) => {
              const seatRows = [0, 1]
                .map((seatIdx) => {
                  const occupantId = team.seats[seatIdx];
                  const occupant = occupantId ? playersById.get(occupantId) : null;
                  if (occupant) {
                    const isMe = occupant.id === state.youId;
                    const canRemove = isHost && !isMe && (occupant.isBot || !occupant.connected);
                    return `
                      <div class="seat-slot occupied">
                        <div class="seat-player-name">
                          <span class="material-symbols-rounded" style="font-size:17px;color:var(--ivory-300)">
                            ${occupant.isBot ? 'smart_toy' : occupant.connected ? 'person' : 'wifi_off'}
                          </span>
                          <span>${escapeHtml(occupant.name)}</span>
                          ${isMe ? '<span class="you-tag">You</span>' : ''}
                          ${occupant.id === state.hostId ? '<span class="you-tag">Host</span>' : ''}
                        </div>
                        ${
                          canRemove
                            ? `<button type="button" class="btn btn-ghost btn-sm" data-action="remove-player" data-player-id="${escapeHtml(occupant.id)}" title="Remove from seat">
                                 <span class="material-symbols-rounded" style="font-size:17px">close</span>
                               </button>`
                            : ''
                        }
                      </div>
                    `;
                  }
                  return `
                    <div class="seat-slot">
                      <span style="color:var(--ivory-400);font-size:0.84rem">Open Partner Seat</span>
                      <div style="display:flex;gap:6px">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="select-seat" data-team="${team.index}" data-seat="${seatIdx}">
                          Sit Here
                        </button>
                        ${
                          isHost
                            ? `<button type="button" class="btn btn-ghost btn-sm" data-action="add-bot" data-team="${team.index}" data-seat="${seatIdx}" title="Add AI Bot">
                                 + Bot
                               </button>`
                            : ''
                        }
                      </div>
                    </div>
                  `;
                })
                .join('');

              return `
                <div class="team-card">
                  <div class="team-card-head">
                    <span style="display:inline-flex;align-items:center;gap:8px">
                      <span class="team-dot dot-${escapeHtml(team.accent)}"></span>
                      <span>Team ${escapeHtml(team.name)}</span>
                    </span>
                    <span style="font-size:0.75rem;color:var(--ivory-400)">Partnership</span>
                  </div>
                  ${seatRows}
                </div>
              `;
            })
            .join('')}
        </div>

        <div style="margin-top:18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary" id="copy-invite-lobby-btn">
            <span class="material-symbols-rounded">share</span>
            <span>Copy Room Invite Link</span>
          </button>

          ${
            isHost
              ? `<button type="button" class="btn btn-primary" id="start-match-btn" ${allFilled ? '' : 'disabled'}>
                   <span class="material-symbols-rounded">play_arrow</span>
                   <span>${allFilled ? 'Start Match — Team Huddle' : `Fill All ${totalSeats} Seats to Start`}</span>
                 </button>`
              : `<span style="color:var(--ivory-300);font-size:0.88rem">Waiting for host to start the match…</span>`
          }
        </div>
      </div>

      <div class="panel-box">
        <div class="meet-setup-box">
          <div class="meet-setup-head">
            <span style="display:inline-flex;align-items:center;gap:6px">
              <span class="material-symbols-rounded" style="color:hsl(146,65%,62%)">videocam</span>
              <span>Google Meet Video Call</span>
            </span>
            <a href="https://meet.new" target="_blank" rel="noopener noreferrer" class="btn btn-meet btn-sm" id="launch-meet-new-btn">
              <span>Start meet.new</span>
              <span class="material-symbols-rounded" style="font-size:15px">open_in_new</span>
            </a>
          </div>
          <div class="setting-hint" style="margin-bottom:8px">
            Keep cameras on in Google Meet for real winks, nods &amp; banter. Paste your call link so everyone can join in one click:
          </div>
          ${
            isHost
              ? `<div class="join-row">
                   <input
                     id="meet-url-input"
                     class="input-field"
                     type="url"
                     placeholder="https://meet.google.com/abc-defg-hij"
                     value="${escapeHtml(state.settings.meetUrl || '')}"
                   />
                   <button type="button" class="btn btn-secondary btn-sm" id="save-meet-btn">Save</button>
                 </div>`
              : state.settings.meetUrl
                ? `<a href="${escapeHtml(state.settings.meetUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-meet" style="width:100%">
                     <span class="material-symbols-rounded">videocam</span>
                     <span>Join Room's Google Meet Call</span>
                   </a>`
                : `<div class="setting-hint">Host hasn't pasted a Google Meet link yet.</div>`
          }
        </div>

        <h2 class="panel-title" style="margin-bottom:12px">House Rules</h2>
        <div class="settings-list">
          <div>
            <span class="field-label">Teams at the Table</span>
            <div class="segmented-row">
              ${[2, 3, 4]
                .map(
                  (n) => `
                <button
                  type="button"
                  class="seg-btn ${state.settings.numTeams === n ? 'active' : ''}"
                  data-setting="numTeams"
                  data-value="${n}"
                  ${isHost ? '' : 'disabled'}
                >
                  ${n} Teams (${n * 2}p)
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <div>
            <span class="field-label">"Not Kemp!" Counter-Call Rule</span>
            <div class="segmented-row">
              <button
                type="button"
                class="seg-btn ${state.settings.notKempMode === 'specific' ? 'active' : ''}"
                data-setting="notKempMode"
                data-value="specific"
                ${isHost ? '' : 'disabled'}
              >
                Accuse Opponent
              </button>
              <button
                type="button"
                class="seg-btn ${state.settings.notKempMode === 'any' ? 'active' : ''}"
                data-setting="notKempMode"
                data-value="any"
                ${isHost ? '' : 'disabled'}
              >
                General Stop
              </button>
            </div>
            <div class="setting-hint">
              ${
                state.settings.notKempMode === 'specific'
                  ? 'Freezes the table and asks you which specific opponent holds 4-of-a-kind.'
                  : 'Checks all opponents at once — if ANY opponent holds 4-of-a-kind, your team wins.'
              }
            </div>
          </div>

          <div>
            <span class="field-label">Spell K-E-M-P Mode</span>
            <div class="segmented-row">
              <button
                type="button"
                class="seg-btn ${state.settings.kempScoringMode === 'earn' ? 'active' : ''}"
                data-setting="kempScoringMode"
                data-value="earn"
                ${isHost ? '' : 'disabled'}
              >
                Earn K-E-M-P
              </button>
              <button
                type="button"
                class="seg-btn ${state.settings.kempScoringMode === 'penalty' ? 'active' : ''}"
                data-setting="kempScoringMode"
                data-value="penalty"
                ${isHost ? '' : 'disabled'}
              >
                Penalty K-E-M-P
              </button>
            </div>
            <div class="setting-hint">
              ${
                state.settings.kempScoringMode === 'earn'
                  ? 'Win rounds to earn letters — first team to spell K-E-M-P wins the match!'
                  : 'Losing a round gives penalty letters — spelling K-E-M-P eliminates a team!'
              }
            </div>
          </div>

          <div>
            <span class="field-label">Between-Round Huddle Timer</span>
            <div class="segmented-row">
              ${[
                { v: 0, label: 'Ready Check' },
                { v: 30, label: '30s' },
                { v: 45, label: '45s' },
                { v: 60, label: '60s' },
              ]
                .map(
                  (opt) => `
                <button
                  type="button"
                  class="seg-btn ${state.settings.huddleSeconds === opt.v ? 'active' : ''}"
                  data-setting="huddleSeconds"
                  data-value="${opt.v}"
                  ${isHost ? '' : 'disabled'}
                >
                  ${opt.label}
                </button>
              `
                )
                .join('')}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderHuddleView(state, ui) {
  const me = state.players.find((p) => p.id === state.youId);
  const myTeam = me && me.teamIndex !== null ? state.teams.find((t) => t.index === me.teamIndex) : null;
  const partner =
    me && me.teamIndex !== null
      ? state.players.find((p) => p.teamIndex === me.teamIndex && p.id !== me.id)
      : null;

  const huddle = state.myHuddle || { messages: [], signalNote: '' };
  const remainingSec =
    state.huddleEndsAt > 0
      ? Math.max(0, Math.ceil((state.huddleEndsAt - (Date.now() - ui.serverClockSkew)) / 1000))
      : null;

  const activePlayers = state.players.filter(
    (p) =>
      p.teamIndex !== null &&
      state.teams.some((t) => t.index === p.teamIndex && !t.eliminated)
  );

  return `
    ${renderScoreboardStrip(state)}
    <section class="huddle-wrap panel-box">
      <div class="huddle-banner">
        <div>
          <h1 class="panel-title">
            Round ${state.roundNumber} — ${myTeam ? `Team ${escapeHtml(myTeam.name)} Secret Huddle` : 'Pre-Round Huddle'}
          </h1>
          <div class="setting-hint">
            ${
              partner
                ? `Private channel with your partner <strong>${escapeHtml(partner.name)}</strong>. Opponents cannot see this.`
                : 'Spectating while teams choose their secret signals.'
            }
          </div>
        </div>
        <div class="huddle-lock-note">
          <span class="material-symbols-rounded" style="font-size:16px">lock_clock</span>
          <span>${remainingSec !== null ? `Deals in ${remainingSec}s` : 'Locks once cards deal'}</span>
        </div>
      </div>

      ${
        me && myTeam && !myTeam.eliminated
          ? `
        <div class="field-group">
          <label class="field-label" for="signal-note-input">Pinned Team Signal Reminder (Hidden Behind Hold-to-Peek During Play)</label>
          <div class="join-row">
            <input
              id="signal-note-input"
              class="input-field"
              type="text"
              maxlength="90"
              placeholder="e.g., Touch left ear = Kemp, adjust glasses = fakeout"
              value="${escapeHtml(huddle.signalNote || '')}"
            />
            <button type="button" class="btn btn-secondary btn-sm" id="save-signal-btn">Pin Signal</button>
          </div>
          <div class="chip-suggestions">
            ${(ui.signalSuggestions || [])
              .map(
                (s) =>
                  `<button type="button" class="suggestion-chip" data-action="use-signal-chip" data-signal="${escapeHtml(s)}">${escapeHtml(s)}</button>`
              )
              .join('')}
          </div>
        </div>

        <div class="huddle-chat-log" id="huddle-chat-log">
          ${
            huddle.messages.length === 0
              ? `<div style="margin:auto;color:var(--ivory-400);font-size:0.84rem;text-align:center">
                   Whisper your plan with ${partner ? escapeHtml(partner.name) : 'your partner'} here so nobody on Google Meet overhears!
                 </div>`
              : huddle.messages
                  .map(
                    (m) => `
                  <div class="huddle-msg ${m.senderId === state.youId ? 'mine' : ''}">
                    <div class="huddle-msg-author">${escapeHtml(m.senderName)}</div>
                    <div>${escapeHtml(m.text)}</div>
                  </div>
                `
                  )
                  .join('')
          }
        </div>

        <form id="huddle-chat-form" class="join-row" style="margin-bottom:16px">
          <input
            id="huddle-chat-input"
            class="input-field"
            type="text"
            maxlength="200"
            placeholder="Message ${partner ? escapeHtml(partner.name) : 'partner'} privately…"
            autocomplete="off"
          />
          <button type="submit" class="btn btn-secondary">Send</button>
        </form>

        <button type="button" class="btn ${me.huddleReady ? 'btn-secondary' : 'btn-primary'}" id="huddle-ready-btn" style="width:100%">
          <span class="material-symbols-rounded">${me.huddleReady ? 'check_circle' : 'bolt'}</span>
          <span>${me.huddleReady ? 'Ready! Waiting for Other Players (Click to Unready)' : 'Lock Signal & Ready to Deal'}</span>
        </button>
      `
          : `<div class="setting-hint">Waiting for active teams to finish their secret huddle…</div>`
      }

      <div class="ready-roster">
        ${activePlayers
          .map(
            (p) => `
          <span class="ready-pill ${p.huddleReady ? 'is-ready' : ''}">
            <span class="material-symbols-rounded" style="font-size:15px">
              ${p.huddleReady ? 'check_circle' : 'schedule'}
            </span>
            <span>${escapeHtml(p.name)}</span>
          </span>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTableArenaView(state, ui) {
  const me = state.players.find((p) => p.id === state.youId);
  const myHand = me?.hand || [];
  const partner =
    me && me.teamIndex !== null
      ? state.players.find((p) => p.teamIndex === me.teamIndex && p.id !== me.id)
      : null;

  // Order other players so your partner appears first, followed by opponents
  const otherSeats = state.players
    .filter((p) => p.id !== state.youId && p.teamIndex !== null)
    .sort((a, b) => {
      const aPartner = partner && a.id === partner.id ? 0 : 1;
      const bPartner = partner && b.id === partner.id ? 0 : 1;
      if (aPartner !== bPartner) return aPartner - bPartner;
      return (a.teamIndex ?? 9) - (b.teamIndex ?? 9);
    });

  const tellsByPlayer = new Map((state.activeTells || []).map((t) => [t.playerId, t]));
  const nowApprox = Date.now() - ui.serverClockSkew;

  // Evaluate my hand rank groupings for helpful status feedback
  const rankCounts = {};
  for (const c of myHand) {
    rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
  }
  let bestCount = 0;
  let bestRank = null;
  for (const [r, cnt] of Object.entries(rankCounts)) {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestRank = r;
    }
  }
  const hasQuad = bestCount === 4;

  let handStatusText = 'Select a card in hand, then tap a center card to swap';
  if (hasQuad) {
    handStatusText = `FOUR ${bestRank}s! Signal ${partner ? partner.name : 'your partner'} — they must yell KEMP!`;
  } else if (bestCount === 3) {
    handStatusText = `3× ${bestRank}s in hand — 1 card away!`;
  } else if (bestCount === 2) {
    handStatusText = `Pair of ${bestRank}s in hand`;
  }

  const canInteractCards = state.phase === 'playing' && me && me.teamIndex !== null && !state.teams[me.teamIndex]?.eliminated;
  const botTellKey = partner?.isBot ? state.myHuddle?.botTellKey : null;

  return `
    ${renderScoreboardStrip(state)}

    <div class="table-arena">
      <!-- Partner & Opponents Ring -->
      <div class="seats-ring">
        ${otherSeats
          .map((p) => {
            const isPartner = Boolean(partner && p.id === partner.id);
            const pTeam = state.teams.find((t) => t.index === p.teamIndex);
            const tell = tellsByPlayer.get(p.id);
            const justSwapped = p.lastSwapAt && nowApprox - p.lastSwapAt < 750;
            const backsCount = Math.max(0, p.cardCount || 0);

            return `
              <div class="seat-pod ${isPartner ? 'is-partner' : ''} ${justSwapped ? 'just-swapped' : ''}">
                <div class="seat-pod-info">
                  <div class="seat-role-tag">
                    <span class="team-dot dot-${escapeHtml(pTeam?.accent || 'emerald')}" style="display:inline-block;width:7px;height:7px;margin-right:4px"></span>
                    ${isPartner ? 'Your Partner' : `Team ${escapeHtml(pTeam?.name || '')}`}
                  </div>
                  <div class="seat-pod-name">
                    ${escapeHtml(p.name)}
                    ${p.flushVoted ? '<span title="Voted for new 4 cards" style="color:var(--brass-300);font-size:0.78rem"> ✓</span>' : ''}
                  </div>
                </div>
                <div class="mini-backs" aria-label="${backsCount} cards in hand">
                  ${Array.from({ length: backsCount })
                    .map(() => '<span class="mini-back"></span>')
                    .join('')}
                </div>
                ${
                  tell
                    ? `<div class="tell-bubble">
                         <span class="material-symbols-rounded" style="font-size:14px">${escapeHtml(tell.icon)}</span>
                         <span>${escapeHtml(tell.label)}</span>
                       </div>`
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>

      <!-- Center 4 Face-Up Cards Pool -->
      <section class="center-well" aria-label="Center Swap Cards">
        <div class="center-meta-row">
          <span>
            <strong>Round ${state.roundNumber}</strong> · ${state.deckRemaining} cards in stock
            ${state.discardCount > 0 ? ` · ${state.discardCount} discarded` : ''}
          </span>
          <button
            type="button"
            class="btn ${me?.flushVoted ? 'btn-primary' : 'btn-secondary'} btn-sm"
            id="vote-flush-btn"
            ${canInteractCards ? '' : 'disabled'}
          >
            <span class="material-symbols-rounded" style="font-size:16px">autorenew</span>
            <span>${me?.flushVoted ? 'Voted New 4' : 'Deal New 4 Cards'} (${state.flushVoteCount}/${state.activePlayerCount})</span>
          </button>
        </div>

        <div class="center-cards-row">
          ${state.centerCards
            .map((card, idx) =>
              renderPlayingCard(card, {
                interactive: canInteractCards,
                selected: ui.selectedCenterIndex === idx,
                swapReady: canInteractCards && Boolean(ui.selectedHandCardId),
                kbd: CENTER_KEYS[idx],
                dataAttrs: `data-card-zone="center" data-center-index="${idx}" data-card-id="${escapeHtml(card.id)}"`,
              })
            )
            .join('')}
        </div>
      </section>

      <!-- Player Hand & Kemp / Not Kemp Slam Controls -->
      <section class="player-dock" aria-label="Your Hand and Calls">
        <div class="hand-header-row">
          <div class="hand-status-badge ${hasQuad ? 'quad-ready' : ''}">
            <span class="material-symbols-rounded" style="font-size:18px">${hasQuad ? 'auto_awesome' : 'playing_cards'}</span>
            <span>${escapeHtml(handStatusText)}</span>
          </div>

          <div style="display:flex;align-items:center;gap:8px">
            ${
              state.myHuddle?.signalNote
                ? `<button type="button" class="signal-peek-pill" id="peek-signal-btn" title="Hold to peek at your team's secret signal">
                     <span class="material-symbols-rounded" style="font-size:14px">visibility</span>
                     <span>${
                       ui.peekingSignal
                         ? escapeHtml(state.myHuddle.signalNote)
                         : 'Hold to Peek Signal'
                     }</span>
                   </button>`
                : ''
            }
          </div>
        </div>

        <div class="hand-And-calls">
          <div class="my-hand-cards">
            ${myHand
              .map((card, idx) =>
                renderPlayingCard(card, {
                  interactive: canInteractCards,
                  selected: ui.selectedHandCardId === card.id,
                  swapReady: canInteractCards && ui.selectedCenterIndex !== null,
                  quadGlow: hasQuad,
                  kbd: HAND_KEYS[idx],
                  dataAttrs: `data-card-zone="hand" data-hand-index="${idx}" data-card-id="${escapeHtml(card.id)}"`,
                })
              )
              .join('')}
          </div>

          <div class="slam-buttons-col">
            <button
              type="button"
              class="btn-slam btn-kemp"
              id="call-kemp-btn"
              ${canInteractCards ? '' : 'disabled'}
            >
              <span class="btn-slam-title">KEMP!</span>
              <span class="btn-slam-sub">${partner ? `${escapeHtml(partner.name)} has 4` : 'Partner has 4'} [K]</span>
            </button>

            <button
              type="button"
              class="btn-slam btn-not-kemp"
              id="call-not-kemp-btn"
              ${canInteractCards ? '' : 'disabled'}
            >
              <span class="btn-slam-title">NOT KEMP!</span>
              <span class="btn-slam-sub">${state.settings.notKempMode === 'specific' ? 'Accuse foe [N]' : 'Stop foes [N]'}</span>
            </button>
          </div>
        </div>

        <div class="tells-toolbar">
          <span style="font-size:0.75rem;color:var(--ivory-400)">
            ${
              partner?.isBot
                ? 'Table Gestures (★ triggers your Bot Partner to call Kemp!):'
                : 'Optional Table Gestures / Decoys (or signal live on Google Meet):'
            }
          </span>
          <div class="tells-buttons">
            ${(ui.tells || [])
              .map((tell) => {
                const isBotSignal = botTellKey === tell.key;
                return `
                  <button
                    type="button"
                    class="tell-chip-btn ${isBotSignal ? 'bot-agreed' : ''}"
                    data-action="send-tell"
                    data-tell="${escapeHtml(tell.key)}"
                    ${canInteractCards ? '' : 'disabled'}
                  >
                    <span class="material-symbols-rounded" style="font-size:14px">${escapeHtml(tell.icon)}</span>
                    <span>${isBotSignal ? `★ ${escapeHtml(tell.label)}` : escapeHtml(tell.label)}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        </div>
      </section>
    </div>

    ${state.phase === 'countdown' ? renderCountdownOverlay(state, ui) : ''}
    ${state.phase === 'accusing' ? renderAccusationOverlay(state, ui) : ''}
    ${state.phase === 'round_over' || state.phase === 'match_over' ? renderShowdownOverlay(state) : ''}
  `;
}

function renderCountdownOverlay(state, ui) {
  const msLeft = Math.max(0, state.countdownEndsAt - (Date.now() - ui.serverClockSkew));
  const sec = Math.max(1, Math.ceil(msLeft / 720));
  return `
    <div class="overlay-backdrop">
      <div class="countdown-badge">
        <div style="font-size:0.85rem;color:var(--ivory-300);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">
          Round ${state.roundNumber} — Partner Chat Locked
        </div>
        <div class="countdown-num">${sec}</div>
        <div style="margin-top:8px;color:var(--ivory-200);font-weight:600">Get ready to grab center cards!</div>
      </div>
    </div>
  `;
}

function renderAccusationOverlay(state, ui) {
  const acc = state.accusation;
  if (!acc) return '';
  const isMe = acc.callerId === state.youId;
  const secLeft = Math.max(0, Math.ceil((acc.expiresAt - (Date.now() - ui.serverClockSkew)) / 1000));
  const opponents = state.players.filter(
    (p) =>
      p.teamIndex !== null &&
      p.teamIndex !== acc.callerTeam &&
      state.teams.some((t) => t.index === p.teamIndex && !t.eliminated)
  );

  return `
    <div class="overlay-backdrop">
      <div class="modal-card" style="max-width:540px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span class="you-tag" style="background:hsla(6,76%,52%,0.22);color:hsl(6,85%,76%)">TABLE FROZEN · NOT KEMP!</span>
          <span style="font-family:var(--font-mono);font-weight:700;color:var(--brass-300)">${secLeft}s</span>
        </div>
        <h2 class="panel-title" style="font-size:1.45rem;margin-bottom:6px">
          ${isMe ? 'Who Holds Four-of-a-Kind?' : `${escapeHtml(acc.callerName)} Yelled NOT KEMP!`}
        </h2>
        <p style="margin:0;color:var(--ivory-300);font-size:0.92rem">
          ${
            isMe
              ? 'Pick the exact opponent you caught signaling. If they hold 4-of-a-kind your team scores — otherwise their team scores!'
              : `All cards are frozen while ${escapeHtml(acc.callerName)} points out the suspect…`
          }
        </p>

        ${
          isMe
            ? `<div class="accuse-grid">
                 ${opponents
                   .map((opp) => {
                     const t = state.teams.find((tm) => tm.index === opp.teamIndex);
                     return `
                       <button type="button" class="accuse-target-btn" data-action="accuse-opponent" data-target-id="${escapeHtml(opp.id)}">
                         <div style="font-size:0.74rem;color:var(--ivory-400);font-weight:700;text-transform:uppercase">
                           Team ${escapeHtml(t?.name || '')}
                         </div>
                         <div style="font-size:1.05rem;font-weight:700;margin-top:3px">
                           Accuse ${escapeHtml(opp.name)}
                         </div>
                       </button>
                     `;
                   })
                   .join('')}
               </div>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderShowdownOverlay(state) {
  const summary = state.roundSummary;
  if (!summary) return '';

  const isMatchOver = state.phase === 'match_over';
  const isHost = state.hostId === state.youId;
  const me = state.players.find((p) => p.id === state.youId);
  const champTeam =
    state.matchWinnerTeam !== null
      ? state.teams.find((t) => t.index === state.matchWinnerTeam)
      : null;

  const revealedList = Object.values(summary.revealedHands || {});

  const changesText = (summary.letterChanges || [])
    .map((chg) => {
      if (chg.kind === 'earned') {
        return `Team ${chg.teamName} earned "${chg.letter}" (${chg.totalWord})`;
      }
      if (chg.kind === 'stripped') {
        return `Team ${chg.teamName} lost "${chg.letter}"`;
      }
      return `Team ${chg.teamName} took penalty "${chg.letter}" (${chg.totalWord})${chg.eliminated ? ' — ELIMINATED!' : ''}`;
    })
    .join(' · ');

  return `
    <div class="overlay-backdrop">
      <div class="modal-card">
        ${
          isMatchOver && champTeam
            ? `<div style="text-align:center;margin-bottom:16px;padding:12px;border-radius:var(--radius-md);background:hsla(40,65%,50%,0.16);border:1px solid var(--brass-400)">
                 <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--brass-300)">
                   Match Complete · K-E-M-P!
                 </div>
                 <div style="font-family:var(--font-display);font-size:1.85rem;font-weight:700;margin-top:2px">
                   Team ${escapeHtml(champTeam.name)} Wins the Match!
                 </div>
               </div>`
            : ''
        }

        <div class="showdown-banner ${summary.success ? 'win' : 'loss'}">
          <div style="font-family:var(--font-display);font-size:1.3rem;font-weight:700">
            ${escapeHtml(summary.headline)}
          </div>
          <div style="color:var(--ivory-200);font-size:0.92rem;margin-top:3px">
            ${escapeHtml(summary.detail)}
          </div>
          ${
            changesText
              ? `<div style="margin-top:8px;font-weight:700;font-size:0.86rem;color:var(--brass-300)">
                   ${escapeHtml(changesText)}
                 </div>`
              : ''
          }
        </div>

        <div class="showdown-hands-grid">
          ${revealedList
            .map((entry) => {
              const team = state.teams.find((t) => t.index === entry.teamIndex);
              return `
                <div class="revealed-player-box ${entry.fourOfAKind ? 'has-quad' : ''}">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                    <span style="font-weight:700;font-size:0.88rem">
                      <span class="team-dot dot-${escapeHtml(team?.accent || 'emerald')}" style="display:inline-block;width:8px;height:8px;margin-right:5px"></span>
                      ${escapeHtml(entry.playerName)}
                    </span>
                    ${
                      entry.fourOfAKind
                        ? `<span class="you-tag">4× ${escapeHtml(entry.matchedRank)}</span>`
                        : ''
                    }
                  </div>
                  <div class="revealed-cards-mini">
                    ${entry.cards.map((c) => renderPlayingCard(c)).join('')}
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          ${
            isHost
              ? `<button type="button" class="btn btn-secondary" id="return-lobby-btn">
                   <span class="material-symbols-rounded">tune</span>
                   <span>Lobby &amp; Rules</span>
                 </button>`
              : '<span></span>'
          }

          ${
            isMatchOver
              ? isHost
                ? `<button type="button" class="btn btn-primary" id="play-again-btn">
                     <span class="material-symbols-rounded">replay</span>
                     <span>Start Rematch</span>
                   </button>`
                : `<span style="color:var(--ivory-300);font-size:0.88rem">Waiting for host to start a rematch…</span>`
              : `<button type="button" class="btn btn-primary" id="next-round-btn" ${me?.nextRoundReady && !isHost ? 'disabled' : ''}>
                   <span class="material-symbols-rounded">arrow_forward</span>
                   <span>${
                     isHost
                       ? 'Next Round — Team Huddle'
                       : me?.nextRoundReady
                         ? 'Ready! Waiting for Table…'
                         : 'Ready for Next Round'
                   }</span>
                 </button>`
          }
        </div>
      </div>
    </div>
  `;
}

export function renderRulesModal() {
  return `
    <div class="overlay-backdrop" id="rules-modal-backdrop">
      <div class="modal-card" style="max-width:620px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h2 class="panel-title" style="font-size:1.4rem">How to Play Kemp Online</h2>
          <button type="button" class="btn btn-ghost btn-sm" id="close-rules-btn">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
        <div style="display:grid;gap:12px;color:var(--ivory-200);font-size:0.92rem">
          <div>
            <strong style="color:var(--brass-300)">1. Pair with Google Meet:</strong>
            Everyone joins one Google Meet call with cameras on so you can see real facial expressions, winks, and bluffs. Keep Kemp open side-by-side or on your phone.
          </div>
          <div>
            <strong style="color:var(--brass-300)">2. Partner Secret Huddle:</strong>
            Before each round, teammates get a private chat box to agree on a secret signal. As soon as cards are dealt, the huddle chat locks &amp; disappears so nobody can text mid-round!
          </div>
          <div>
            <strong style="color:var(--brass-300)">3. Simultaneous Free-for-All Swaps:</strong>
            Everyone gets 4 cards, and 4 cards flip face-up in the center. There are <strong>no turns</strong> — click a card in your hand (or keys <code>1–4</code>) and a center card (<code>Q W E R</code>) to swap. If nobody wants the center cards, click <strong>Deal New 4 Cards</strong> (<code>Space</code>).
          </div>
          <div>
            <strong style="color:var(--brass-300)">4. Yelling "KEMP!" vs. "NOT KEMP!":</strong>
            You <strong>cannot</strong> call Kemp for yourself! When you collect 4-of-a-kind, signal your partner so <em>they</em> slam <strong>KEMP!</strong> (<code>K</code>). Meanwhile, if you spot an opponent signaling, slam <strong>NOT KEMP!</strong> (<code>N</code>) before their partner calls Kemp!
          </div>
          <div>
            <strong style="color:var(--brass-300)">5. Spelling K-E-M-P:</strong>
            Each round awards a letter of <strong>K-E-M-P</strong> (either race to spell KEMP first, or elimination penalty mode — configurable by the host in the lobby).
          </div>
        </div>
      </div>
    </div>
  `;
}
