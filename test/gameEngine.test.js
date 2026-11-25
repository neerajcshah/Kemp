import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addBotToSeat,
  beginCountdownAndDeal,
  callKemp,
  callNotKemp,
  createPlayerRecord,
  createRoom,
  evaluateFourOfAKind,
  fillEmptySeatsWithBots,
  sanitizeMeetUrl,
  sendHuddleMessage,
  serializeRoomForPlayer,
  setTeamTellKey,
  startMatch,
  swapCard,
  toggleFlushVote,
  toggleHuddleReady,
  updateRoomSettings,
} from '../server/gameEngine.js';

function setupLive2v2Room(customSettings = {}) {
  const host = createPlayerRecord({ name: 'Alice' });
  const room = createRoom('TEST', host);
  updateRoomSettings(room, host.id, customSettings);

  const partner = createPlayerRecord({ name: 'Bob' });
  const opp1 = createPlayerRecord({ name: 'Cara' });
  const opp2 = createPlayerRecord({ name: 'Dan' });

  // Seat Alice & Bob on Team 0, Cara & Dan on Team 1
  room.players.set(partner.id, partner);
  partner.teamIndex = 0;
  partner.seatIndex = 1;
  room.teams[0].seats[1] = partner.id;

  room.players.set(opp1.id, opp1);
  opp1.teamIndex = 1;
  opp1.seatIndex = 0;
  room.teams[1].seats[0] = opp1.id;

  room.players.set(opp2.id, opp2);
  opp2.teamIndex = 1;
  opp2.seatIndex = 1;
  room.teams[1].seats[1] = opp2.id;

  startMatch(room, host.id);
  assert.equal(room.phase, 'huddle');

  // Ready up all 4 humans, skip countdown
  beginCountdownAndDeal(room, 0);
  assert.equal(room.phase, 'playing');

  return { room, host, partner, opp1, opp2 };
}

test('Secret partner huddle isolates messages per team and locks during play', () => {
  const host = createPlayerRecord({ name: 'Alice' });
  const room = createRoom('HUDL', host);
  const partner = createPlayerRecord({ name: 'Bob' });
  const opp1 = createPlayerRecord({ name: 'Cara' });
  const opp2 = createPlayerRecord({ name: 'Dan' });

  room.players.set(partner.id, partner);
  partner.teamIndex = 0;
  partner.seatIndex = 1;
  room.teams[0].seats[1] = partner.id;

  room.players.set(opp1.id, opp1);
  opp1.teamIndex = 1;
  opp1.seatIndex = 0;
  room.teams[1].seats[0] = opp1.id;

  room.players.set(opp2.id, opp2);
  opp2.teamIndex = 1;
  opp2.seatIndex = 1;
  room.teams[1].seats[1] = opp2.id;

  startMatch(room, host.id);
  sendHuddleMessage(room, host.id, 'Scratch nose for 4-of-a-kind');
  const tellRes = setTeamTellKey(room, host.id, 'sip');
  assert.equal(tellRes.ok, true);

  const partnerView = serializeRoomForPlayer(room, partner.id);
  const oppView = serializeRoomForPlayer(room, opp1.id);

  assert.equal(partnerView.myHuddle.messages.length, 1);
  assert.equal(partnerView.myHuddle.messages[0].text, 'Scratch nose for 4-of-a-kind');
  assert.equal(partnerView.myHuddle.teamTellKey, 'sip');
  assert.notEqual(oppView.myHuddle.teamTellKey, 'sip');
  assert.equal(oppView.myHuddle.messages.length, 0);

  // Ready everyone -> deals cards and hides huddle messages
  for (const p of [host, partner, opp1, opp2]) {
    toggleHuddleReady(room, p.id);
  }
  assert.equal(room.phase, 'countdown');

  const lockedSend = sendHuddleMessage(room, host.id, 'Hey I got 4 Kings!');
  assert.equal(lockedSend.ok, false);

  const livePartnerView = serializeRoomForPlayer(room, partner.id);
  assert.equal(livePartnerView.myHuddle.messages.length, 0);
  assert.equal(livePartnerView.myHuddle.teamTellKey, 'sip');
  // Opponent hands remain hidden during live play
  const caraEntry = livePartnerView.players.find((p) => p.id === opp1.id);
  assert.equal(caraEntry.hand, null);
  assert.equal(caraEntry.cardCount, 4);
});

test('Simultaneous card swap enforces expectedCenterCardId race protection and tracks public Took/Left cards', () => {
  const { room, host, partner, opp1 } = setupLive2v2Room();

  const targetCenter = room.centerCards[0];
  const hostDiscard = host.hand[0];
  const oppDiscard = opp1.hand[0];

  // Alice wins the race for center slot 0
  const firstGrab = swapCard(room, host.id, hostDiscard.id, 0, targetCenter.id);
  assert.equal(firstGrab.ok, true);
  assert.ok(host.hand.some((c) => c.id === targetCenter.id));
  assert.equal(room.centerCards[0].id, hostDiscard.id);

  // Partner & Opponent views publicly record which face-up card Alice took and left, while keeping her hand hidden
  const oppProjected = serializeRoomForPlayer(room, opp1.id);
  const aliceOnOppView = oppProjected.players.find((p) => p.id === host.id);
  assert.equal(aliceOnOppView.hand, null);
  assert.equal(aliceOnOppView.lastSwap.pickedUp.id, targetCenter.id);
  assert.equal(aliceOnOppView.lastSwap.discarded.id, hostDiscard.id);
  assert.equal(oppProjected.recentSwaps.length, 1);
  assert.equal(oppProjected.recentSwaps[0].pickedUp.id, targetCenter.id);

  // Cara's packet arrives 10ms later expecting the old card -> cleanly rejected!
  const staleGrab = swapCard(room, opp1.id, oppDiscard.id, 0, targetCenter.id);
  assert.equal(staleGrab.ok, false);
  assert.equal(staleGrab.code, 'RACE_LOST');
  // Cara keeps her original card
  assert.ok(opp1.hand.some((c) => c.id === oppDiscard.id));
  assert.ok(partner);
});

test('Unanimous flush vote deals 4 new center cards and resets on swap', () => {
  const { room, host, partner, opp1, opp2 } = setupLive2v2Room();

  toggleFlushVote(room, host.id);
  toggleFlushVote(room, partner.id);
  assert.equal(room.flushVotes.size, 2);

  // A swap resets flush votes
  swapCard(room, opp1.id, opp1.hand[0].id, 1, room.centerCards[1].id);
  assert.equal(room.flushVotes.size, 0);

  // All 4 vote to flush -> flushes center
  toggleFlushVote(room, host.id);
  toggleFlushVote(room, partner.id);
  toggleFlushVote(room, opp1.id);
  const finalVote = toggleFlushVote(room, opp2.id);

  assert.equal(finalVote.flushed, true);
  assert.equal(room.flushCount, 1);
  assert.equal(room.centerCards.length, 4);
  assert.equal(room.discardPile.length, 4);
});

test('Valid Kemp and False Kemp award K-E-M-P letters accurately', () => {
  const { room, host, partner } = setupLive2v2Room({ kempScoringMode: 'earn' });

  // Give partner 4 Queens
  partner.hand = [
    { id: 'QS', rank: 'Q', suit: 'S' },
    { id: 'QH', rank: 'Q', suit: 'H' },
    { id: 'QD', rank: 'Q', suit: 'D' },
    { id: 'QC', rank: 'Q', suit: 'C' },
  ];
  assert.equal(evaluateFourOfAKind(partner.hand).match, true);

  const validRes = callKemp(room, host.id);
  assert.equal(validRes.ok, true);
  assert.equal(validRes.outcome.success, true);
  assert.equal(room.teams[0].letters, 1); // 'K'
  assert.equal(room.phase, 'round_over');

  // False Kemp in a fresh round gives opposing team 'K'
  beginCountdownAndDeal(room, 0);
  partner.hand = [
    { id: 'AS', rank: 'A', suit: 'S' },
    { id: 'AH', rank: 'A', suit: 'H' },
    { id: 'AD', rank: 'A', suit: 'D' },
    { id: 'KC', rank: 'K', suit: 'C' },
  ];
  const falseRes = callKemp(room, host.id);
  assert.equal(falseRes.outcome.success, false);
  assert.equal(room.teams[1].letters, 1);
});

test('Not Kemp supports both Specific Opponent accusation and Any Opponent general stop', () => {
  // 1. Specific opponent mode
  const { room, host, opp1, opp2 } = setupLive2v2Room({
    notKempMode: 'specific',
    kempScoringMode: 'earn',
  });

  opp2.hand = [
    { id: '9S', rank: '9', suit: 'S' },
    { id: '9H', rank: '9', suit: 'H' },
    { id: '9D', rank: '9', suit: 'D' },
    { id: '9C', rank: '9', suit: 'C' },
  ];

  // Slamming Not Kemp without target freezes table into 'accusing'
  const freezeRes = callNotKemp(room, host.id);
  assert.equal(freezeRes.awaitingTarget, true);
  assert.equal(room.phase, 'accusing');

  // Accusing Dan (opp2) succeeds!
  const catchRes = callNotKemp(room, host.id, opp2.id);
  assert.equal(catchRes.outcome.success, true);
  assert.equal(room.teams[0].letters, 1);

  // 2. General stop ('any') mode
  updateRoomSettings(room, host.id, {});
  room.settings.notKempMode = 'any';
  beginCountdownAndDeal(room, 0);
  opp1.hand = [
    { id: 'JS', rank: 'J', suit: 'S' },
    { id: 'JH', rank: 'J', suit: 'H' },
    { id: 'JD', rank: 'J', suit: 'D' },
    { id: 'JC', rank: 'J', suit: 'C' },
  ];

  const generalCatch = callNotKemp(room, host.id);
  assert.equal(generalCatch.outcome.success, true);
  assert.equal(room.teams[0].letters, 2); // 'KE'
});

test('Supports up to 4 teams (8 seats) + bots and Google Meet URL sanitization', () => {
  const host = createPlayerRecord({ name: 'Host' });
  const room = createRoom('8PLY', host);
  updateRoomSettings(room, host.id, {
    numTeams: 4,
    meetUrl: 'meet.google.com/abc-defg-hij',
  });

  assert.equal(room.settings.numTeams, 4);
  assert.equal(room.settings.meetUrl, 'https://meet.google.com/abc-defg-hij');
  assert.equal(sanitizeMeetUrl('https://evil.example.com/phish'), '');

  const fill = fillEmptySeatsWithBots(room);
  assert.equal(fill.added.length, 7);
  assert.equal(room.players.size, 8);

  const addExtra = addBotToSeat(room, 0, 1);
  assert.equal(addExtra.ok, false);
});
