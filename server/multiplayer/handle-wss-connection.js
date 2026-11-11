import hasValidCharacters from '../moderation/has-valid-characters.js';
import isAppropriateString from '../moderation/is-appropriate-string.js';
import { createAndReturnRoom } from './TossupRoom.js';
import { createAndReturnTeamRoom } from './TeamTossupRoom.js';
import { getRankedConnection } from '../ranked/matchmaking.js';
import { RANKED_ENABLED } from '../../constants.js';
import { getVerifiedUsernameFromCookie, sessionKeys } from '../authentication.js';

import getRandomName from '../../get-random-name.js';

import crypto from 'crypto';
import url from 'url';

// A player's id in a room comes from their signed-in account, never from the
// URL: a client-chosen id let anyone take over another player's seat and
// score. Keyed, so it can't be worked out from a username.
function playerIdFor (verifiedUsername) {
  return crypto.createHmac('sha256', sessionKeys[0]).update(verifiedUsername.toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * Handle WebSocket connection
 * @param {WebSocket} ws
 * @param {http.IncomingMessage} req
 */
export default function handleWssConnection (ws, req) {
  const parsedUrl = new url.URL(req.url, process.env.BASE_URL ?? 'http://localhost');
  const isPrivate = parsedUrl.searchParams.get('private') === 'true';
  const roomName = parsedUrl.searchParams.get('roomName');
  const rankedTicket = parsedUrl.searchParams.get('rankedTicket');
  const mode = parsedUrl.searchParams.get('mode');
  const teamCount = parseInt(parsedUrl.searchParams.get('teamCount') ?? '2', 10);
  const schoolId = parsedUrl.searchParams.get('schoolId') || null;
  let username = parsedUrl.searchParams.get('username') ?? getRandomName();

  // The query-string username is display-only and client-controlled. For
  // authorization (e.g. selecting a private uploaded set) we verify the
  // session cookie on the upgrade request instead.
  const verifiedUsername = getVerifiedUsernameFromCookie(req.headers.cookie);

  // The rest of the site needs a signed-in session; websocket upgrades skip
  // that check, so it is made here.
  if (!verifiedUsername) {
    ws.send(JSON.stringify({ type: 'error', error: 'Sign in to play multiplayer.' }));
    ws.close();
    return false;
  }

  const userId = playerIdFor(verifiedUsername);

  if (rankedTicket) {
    if (!RANKED_ENABLED) {
      ws.send(JSON.stringify({ type: 'error', error: 'Ranked play is not available right now.' }));
      return false;
    }
    const rankedConnection = getRankedConnection(rankedTicket, roomName);
    if (!rankedConnection) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'This ranked match link is invalid or has expired.'
      }));
      return false;
    }

    rankedConnection.room.connection(
      ws,
      rankedConnection.userId,
      rankedConnection.username
    );
    return true;
  }

  if (!hasValidCharacters(roomName)) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'The room name contains an invalid character. Only A-Z, a-z, 0-9, - and _ are allowed.'
    }));
    return false;
  }

  if (!isAppropriateString(roomName)) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'The room name contains an inappropriate word.'
    }));
    return false;
  }

  const room = mode === 'team'
    ? createAndReturnTeamRoom(roomName, teamCount, [], isPrivate)
    : createAndReturnRoom(roomName, isPrivate);

  // Record the joining player's school so TeamTossupRoom.pickTeamForPlayer
  // can use it for auto-assign. Safe no-op on solo rooms.
  if (room.playerSchool) {
    room.playerSchool[userId] = schoolId;
  }

  if (room.settings.lock === true) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'The room is locked'
    }));
    return false;
  }

  if (!isAppropriateString(username)) {
    username = getRandomName();
    ws.send(JSON.stringify({
      type: 'force-username',
      username,
      message: 'Your username contains an inappropriate word, so it has been reset.'
    }));
  }

  room.connection(ws, userId, username, verifiedUsername);

  ws.on('error', (err) => {
    if (err instanceof RangeError) {
      console.log(`[WEBSOCKET] WARNING: Max payload exceeded from ip ${ws._socket.remoteAddress}`);
      ws.close();
    } else {
      console.log(err);
    }
  });
}
