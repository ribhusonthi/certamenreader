import { tossupRooms } from '../../server/multiplayer/TossupRoom.js';
import { teamTossupRooms } from '../../server/multiplayer/TeamTossupRoom.js';

import { Router } from 'express';
const router = Router();

router.get('/room-list', (req, res) => {
  const roomList = [];
  for (const roomName in tossupRooms) {
    if (!tossupRooms[roomName].settings.public) {
      continue;
    }

    roomList.push({
      roomName,
      playerCount: Object.keys(tossupRooms[roomName].players).length,
      onlineCount: Object.keys(tossupRooms[roomName].sockets).length,
      isPermanent: tossupRooms[roomName].isPermanent
    });
  }

  res.header('Access-Control-Allow-Origin', '*');
  res.json({ roomList });
});

router.get('/team-room-list', (req, res) => {
  const roomList = [];
  for (const roomName in teamTossupRooms) {
    const room = teamTossupRooms[roomName];
    if (!room.settings.public) continue;
    roomList.push({
      roomName,
      playerCount: Object.keys(room.players).length,
      onlineCount: Object.keys(room.sockets).length,
      teamCount: room.teamCount,
      teamNames: room.teamNames
    });
  }
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ roomList });
});

export default router;
