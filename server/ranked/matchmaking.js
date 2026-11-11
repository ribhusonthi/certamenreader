import crypto from 'crypto';

import RankedRoom from './RankedRoom.js';
import { getOrCreateRating, getRankedLeaderboard, getRankedProfile, serializeRating } from '../../database/account-info/ranked.js';
import { RANKED_MODES, getRankedMode } from './constants.js';

const queues = new Map();
const tickets = new Map();
const rankedRooms = new Map();
const presence = new Map();
const PRESENCE_TTL_MS = 45 * 1000;

function getQueue (mode) {
  const rankedMode = getRankedMode(mode);
  if (!queues.has(rankedMode.id)) {
    queues.set(rankedMode.id, []);
  }
  return queues.get(rankedMode.id);
}

function prunePresence () {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  for (const [username, entry] of presence.entries()) {
    if (entry.lastSeen.getTime() < cutoff) {
      presence.delete(username);
    }
  }
}

function recordRankedPresence ({ username, mode }) {
  const rankedMode = getRankedMode(mode);
  presence.set(username, {
    username,
    mode: rankedMode.id,
    lastSeen: new Date()
  });
  return getRankedActivity();
}

function getRankedActivity () {
  prunePresence();

  const queuedByMode = {};
  const activeByMode = {};
  for (const mode of Object.keys(RANKED_MODES)) {
    queuedByMode[mode] = getQueue(mode).length;
    activeByMode[mode] = 0;
  }

  for (const entry of presence.values()) {
    activeByMode[entry.mode] = (activeByMode[entry.mode] ?? 0) + 1;
  }

  return {
    activeUsers: presence.size,
    activeByMode,
    queuedByMode
  };
}

function removeQueuedUsername (username) {
  for (const queue of queues.values()) {
    const index = queue.findIndex(entry => entry.username === username);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }
}

function getSearchRange (entry) {
  const seconds = (Date.now() - entry.createdAt.getTime()) / 1000;
  return 125 + (seconds * 20);
}

function findOpponent (entry, queue) {
  let best = null;
  let bestDelta = Infinity;

  for (const candidate of queue) {
    if (candidate.username === entry.username) continue;

    const delta = Math.abs(candidate.rating.rating - entry.rating.rating);
    const range = Math.max(getSearchRange(entry), getSearchRange(candidate));
    if (delta <= range && delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }

  return best;
}

function createMatch (entry, opponent) {
  const roomName = `ranked-${entry.ticket.slice(0, 8)}-${opponent.ticket.slice(0, 8)}`;
  const players = [entry, opponent].map(player => ({
    username: player.username,
    rating: serializeRating(player.rating)
  }));
  const room = new RankedRoom({ roomName, mode: entry.mode, players });
  rankedRooms.set(roomName, room);

  for (const player of [entry, opponent]) {
    const ticket = tickets.get(player.ticket);
    ticket.status = 'matched';
    ticket.roomName = roomName;
    ticket.matchedAt = new Date();
    ticket.opponent = players.find(p => p.username !== player.username);
  }

  return room;
}

async function joinRankedQueue ({ username, mode }) {
  const rankedMode = getRankedMode(mode);
  removeQueuedUsername(username);

  const rating = await getOrCreateRating(username, rankedMode.id);
  const ticket = crypto.randomUUID();
  const entry = {
    ticket,
    username,
    mode: rankedMode.id,
    rating,
    createdAt: new Date()
  };
  const queue = getQueue(rankedMode.id);
  const opponent = findOpponent(entry, queue);

  tickets.set(ticket, {
    ticket,
    username,
    mode: rankedMode.id,
    status: opponent ? 'matched' : 'queued',
    roomName: null,
    opponent: null,
    createdAt: entry.createdAt
  });

  if (opponent) {
    queue.splice(queue.indexOf(opponent), 1);
    createMatch(entry, opponent);
  } else {
    queue.push(entry);
  }

  return getTicketStatus(ticket);
}

function cancelRankedQueue (ticket, username) {
  const record = tickets.get(ticket);
  if (!record || record.username !== username || record.status !== 'queued') {
    return false;
  }

  const queue = getQueue(record.mode);
  const index = queue.findIndex(entry => entry.ticket === ticket);
  if (index !== -1) queue.splice(index, 1);
  record.status = 'cancelled';
  return true;
}

function getTicketStatus (ticket) {
  const record = tickets.get(ticket);
  if (!record) return null;

  return {
    ...record,
    queueSeconds: Math.round((Date.now() - record.createdAt.getTime()) / 1000),
    activity: getRankedActivity()
  };
}

function getRankedConnection (ticket, roomName) {
  const record = tickets.get(ticket);
  if (!record || record.status !== 'matched' || record.roomName !== roomName) {
    return null;
  }

  const room = rankedRooms.get(roomName);
  if (!room) return null;

  return {
    room,
    userId: `ranked:${record.username}`,
    username: record.username
  };
}

async function getRankedHome (username) {
  const profile = await getRankedProfile(username);
  const leaderboards = {};
  for (const mode of Object.keys(RANKED_MODES)) {
    leaderboards[mode] = await getRankedLeaderboard(mode, 10);
  }
  return {
    activity: getRankedActivity(),
    modes: RANKED_MODES,
    profile,
    leaderboards
  };
}

export {
  cancelRankedQueue,
  getRankedActivity,
  getRankedConnection,
  getRankedHome,
  getTicketStatus,
  joinRankedQueue,
  recordRankedPresence
};
