import crypto from 'node:crypto';
import {
  TABLE_TELLS,
  callKemp,
  callNotKemp,
  evaluateFourOfAKind,
  getActivePlayers,
  getPartner,
  swapCard,
  toggleFlushVote,
  triggerTableTell,
} from './gameEngine.js';

/**
 * Evaluate one AI tick for all bots in an active room.
 * Returns true if any room state mutated so the server can broadcast updates.
 */
export function tickRoomBots(room) {
  if (room.phase !== 'playing') return false;

  const now = Date.now();
  const activePlayers = getActivePlayers(room);
  const bots = activePlayers.filter((p) => p.isBot);
  if (bots.length === 0) return false;

  if (!room._botMeta) {
    room._botMeta = new Map();
  }

  let changed = false;

  for (const bot of bots) {
    // Re-check phase in case an earlier bot in this loop called Kemp / Not Kemp
    if (room.phase !== 'playing') break;

    let meta = room._botMeta.get(bot.id);
    if (!meta || meta.round !== room.roundNumber) {
      meta = {
        round: room.roundNumber,
        nextThinkAt: now + randomBetween(900, 1900),
        lastSignalAt: 0,
        pendingKempAt: 0,
        observedTells: new Map(), // opponentId -> count
      };
      room._botMeta.set(bot.id, meta);
    }

    const huddle = room.teamHuddles.get(bot.teamIndex);
    const partner = getPartner(room, bot.id);

    // 1. Check if partner signaled with the agreed tell
    if (partner && huddle?.botTellKey) {
      const partnerTell = room.activeTells.get(partner.id);
      if (partnerTell && partnerTell.tellKey === huddle.botTellKey) {
        if (!meta.pendingKempAt) {
          meta.pendingKempAt = now + randomBetween(950, 1750);
        }
      }
    }

    if (meta.pendingKempAt && now >= meta.pendingKempAt) {
      meta.pendingKempAt = 0;
      const res = callKemp(room, bot.id);
      if (res.ok) {
        changed = true;
        break;
      }
    }

    if (now < meta.nextThinkAt) continue;
    meta.nextThinkAt = now + randomBetween(1050, 2100);

    // 2. Watch opponent tells — if an opponent lingers with 4-of-a-kind tells repeatedly, maybe counter-call!
    for (const tell of room.activeTells.values()) {
      if (tell.teamIndex !== bot.teamIndex) {
        const key = `${tell.playerId}:${tell.timestamp}`;
        if (!meta.observedTells.has(key)) {
          meta.observedTells.set(key, true);
          const countKey = `count:${tell.playerId}`;
          const prevCount = (meta.observedTells.get(countKey) || 0) + 1;
          meta.observedTells.set(countKey, prevCount);

          // Only attempt an intercept if opponent has signaled multiple times or after a fair window
          const catchChance = prevCount >= 2 ? 42 : 14;
          if (now - tell.timestamp > 1100 && crypto.randomInt(0, 100) < catchChance) {
            const targetId = room.settings.notKempMode === 'specific' ? tell.playerId : null;
            const res = callNotKemp(room, bot.id, targetId);
            if (res.ok) {
              changed = true;
              break;
            }
          }
        }
      }
    }
    if (room.phase !== 'playing') break;

    // 3. Check own hand for 4-of-a-kind
    const ownQuad = evaluateFourOfAKind(bot.hand);
    if (ownQuad.match) {
      // Signal partner periodically using agreed botTellKey
      if (huddle?.botTellKey && now - meta.lastSignalAt > randomBetween(3100, 4600)) {
        meta.lastSignalAt = now;
        const tellRes = triggerTableTell(room, bot.id, huddle.botTellKey);
        if (tellRes.ok) changed = true;
      }
      // Also vote flush if everyone else is waiting so bot doesn't look frozen
      if (!room.flushVotes.has(bot.id) && now - room.lastFlushAt > 5000 && crypto.randomInt(0, 100) < 40) {
        const fRes = toggleFlushVote(room, bot.id);
        if (fRes.ok) changed = true;
      }
      continue;
    }

    // 4. Look for a beneficial swap with centerCards
    const move = chooseBestSwap(bot.hand, room.centerCards);
    if (move) {
      const targetCenterCard = room.centerCards[move.centerIndex];
      const res = swapCard(room, bot.id, move.discardCardId, move.centerIndex, targetCenterCard?.id);
      if (res.ok) {
        changed = true;
        continue;
      }
    }

    // 5. Occasional harmless decoy tell to keep human opponents on their toes
    if (crypto.randomInt(0, 100) < 5 && now - meta.lastSignalAt > 7000) {
      const decoyKeys = Object.keys(TABLE_TELLS).filter((k) => k !== huddle?.botTellKey);
      const decoyKey = decoyKeys[crypto.randomInt(0, decoyKeys.length)];
      meta.lastSignalAt = now;
      if (triggerTableTell(room, bot.id, decoyKey).ok) {
        changed = true;
      }
    }

    // 6. If no center card helps and center has been out for >= 2.6s, vote to flush
    if (!room.flushVotes.has(bot.id) && now - room.lastFlushAt > 2600) {
      const fRes = toggleFlushVote(room, bot.id);
      if (fRes.ok) changed = true;
    }
  }

  return changed;
}

/**
 * Pick a smart swap that increases rank concentration in a 4-card hand.
 */
function chooseBestSwap(hand, centerCards) {
  if (!hand || hand.length !== 4 || !centerCards || centerCards.length === 0) return null;

  const handCounts = countRanks(hand);
  const currentScore = scoreHandConcentration(handCounts);

  let bestOption = null;
  let bestGain = 0;

  for (let cIdx = 0; cIdx < centerCards.length; cIdx++) {
    const cCard = centerCards[cIdx];
    if (!cCard) continue;

    for (let hIdx = 0; hIdx < hand.length; hIdx++) {
      const hCard = hand[hIdx];
      if (hCard.rank === cCard.rank) continue;

      const simulated = [...hand];
      simulated[hIdx] = cCard;
      const newScore = scoreHandConcentration(countRanks(simulated));
      const gain = newScore - currentScore;

      if (gain > bestGain) {
        bestGain = gain;
        bestOption = {
          discardCardId: hCard.id,
          centerIndex: cIdx,
        };
      }
    }
  }

  return bestOption;
}

function countRanks(cards) {
  const counts = {};
  for (const c of cards) {
    counts[c.rank] = (counts[c.rank] || 0) + 1;
  }
  return counts;
}

function scoreHandConcentration(rankCounts) {
  let score = 0;
  for (const count of Object.values(rankCounts)) {
    if (count === 4) score += 1000;
    else if (count === 3) score += 90;
    else if (count === 2) score += 20;
    else score += 1;
  }
  return score;
}

function randomBetween(min, max) {
  return crypto.randomInt(min, max + 1);
}
