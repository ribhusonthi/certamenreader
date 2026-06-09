import api from '../api/index.js';

const ROOM_NAME_MAX_LENGTH = 32;

document.getElementById('form').addEventListener('submit', (event) => {
  event.preventDefault();

  let roomName = document.getElementById('new-room-name').value;
  if (roomName.length === 0) {
    roomName = document.getElementById('new-room-name').placeholder;
  } else {
    roomName = roomName.replaceAll(' ', '-');
  }
  roomName = roomName.substring(0, ROOM_NAME_MAX_LENGTH);

  const teamCount = parseInt(document.getElementById('team-count').value, 10) || 2;
  const isPrivate = document.getElementById('private-room-checkbox').checked;
  const qs = new URLSearchParams({ teamCount: String(teamCount) });
  if (isPrivate) qs.set('private', 'true');
  window.location.href = `/multiplayer/team/${encodeURIComponent(roomName)}?${qs}`;
});

fetch('/api/multiplayer/team-room-list')
  .then(response => response.json())
  .then(data => {
    const { roomList } = data;
    roomList.sort((a, b) => {
      if (a.onlineCount === b.onlineCount) return b.playerCount - a.playerCount;
      return b.onlineCount - a.onlineCount;
    });
    return roomList;
  })
  .then(roomList => {
    const container = document.getElementById('room-list');
    roomList.forEach(room => {
      const { roomName, playerCount, onlineCount, teamCount } = room;
      const status = onlineCount >= teamCount * 4 ? 'full' : onlineCount > 0 ? 'reading' : 'waiting';
      const a = document.createElement('a');
      a.href = `/multiplayer/team/${encodeURIComponent(roomName)}`;
      a.className = 'mp-room';
      a.innerHTML = `
        <div class="mp-room-hdr">
          <div class="mp-room-name"></div>
          <div class="mp-room-status" data-status="${status}">${status}</div>
        </div>
        <div class="mp-room-set">
          <div class="set-name">${teamCount}-team room</div>
          <div class="set-meta">${onlineCount} ONLINE · ${playerCount} TOTAL</div>
        </div>
      `;
      a.querySelector('.mp-room-name').textContent = roomName;
      container.appendChild(a);
    });

    const createCard = document.createElement('div');
    createCard.className = 'mp-create';
    createCard.innerHTML = '<div class="plus">+</div><div>Create a new team room</div>';
    createCard.addEventListener('click', () => document.getElementById('new-room-name').focus());
    container.appendChild(createCard);
  })
  .catch(() => {
    document.getElementById('room-list').innerHTML =
      '<p class="text-danger">Failed to load team rooms.</p>';
  });

document.getElementById('new-room-name').placeholder = await api.getRandomName();
