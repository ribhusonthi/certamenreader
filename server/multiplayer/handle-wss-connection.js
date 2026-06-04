import hasValidCharacters from '../moderation/has-valid-characters.js';
import isAppropriateString from '../moderation/is-appropriate-string.js';
import { createAndReturnRoom } from './TossupRoom.js';
import { getRankedConnection } from '../ranked/matchmaking.js';
import getAuthedUsername from '../get-authed-username.js';

import getRandomName from '../../get-random-name.js';

import url from 'url';
import * as uuid from 'uuid';

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
  let userId = parsedUrl.searchParams.get('userId') ?? 'unknown';
  let username = parsedUrl.searchParams.get('username') ?? getRandomName();

  userId = (userId === 'unknown') ? uuid.v4() : userId;

  if (rankedTicket) {
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

  const room = createAndReturnRoom(roomName, isPrivate);
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

  // Resolve a SERVER-TRUSTED identity from the signed session cookie on the
  // upgrade request. The userId/username query params are client-supplied and
  // spoofable, so authorizing set-name selection of private (uploaded) sets
  // must use this. Null for anonymous sockets — they can still play public sets.
  const authedUsername = getAuthedUsername(req);
  room.connection(ws, userId, username, authedUsername);

  ws.on('error', (err) => {
    if (err instanceof RangeError) {
      console.log(`[WEBSOCKET] WARNING: Max payload exceeded from ip ${ws._socket.remoteAddress}`);
      ws.close();
    } else {
      console.log(err);
    }
  });
}
