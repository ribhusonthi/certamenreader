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

  const isPrivate = document.getElementById('private-room-checkbox').checked;
  if (isPrivate) {
    window.location.href = `/multiplayer/${encodeURIComponent(roomName)}?private=${isPrivate}`;
  } else {
    window.location.href = '/multiplayer/' + encodeURIComponent(roomName);
  }
});

fetch('/api/multiplayer/room-list')
  .then(response => response.json())
  .then(data => {
    const { roomList } = data;
    roomList.sort((a, b) => {
      if (a.onlineCount === b.onlineCount) {
        return b.playerCount - a.playerCount;
      } else {
        return b.onlineCount - a.onlineCount;
      }
    });
    return roomList;
  })
  .then(roomList => {
    roomList.forEach(room => {
      const { roomName, playerCount, onlineCount, isPermanent } = room;

      if (isPermanent) return;

      const status = onlineCount >= 6 ? 'full' : onlineCount > 0 ? 'reading' : 'waiting';
      const palette = ['#d4af37', '#66023c', '#2e8b57', '#00416a', '#c80815', '#b995ec'];
      const avatars = [];
      const avCount = Math.min(playerCount, 4);
      for (let i = 0; i < avCount; i++) {
        const ch = (roomName[i] || '?').toUpperCase();
        avatars.push(`<div class="mp-avatar" style="background: ${palette[i % palette.length]}">${ch}</div>`);
      }

      const a = document.createElement('a');
      a.href = `/multiplayer/${encodeURIComponent(roomName)}`;
      a.className = 'mp-room';
      a.innerHTML = `
        <div class="mp-room-hdr">
          <div class="mp-room-name"></div>
          <div class="mp-room-status" data-status="${status}">${status}</div>
        </div>
        <div class="mp-room-set">
          <div class="set-name">Public room</div>
          <div class="set-meta">${onlineCount} ONLINE · ${playerCount} TOTAL</div>
        </div>
        <div class="mp-room-players">
          <div class="mp-avatars">${avatars.join('')}</div>
          <span>${playerCount} player${playerCount === 1 ? '' : 's'}</span>
        </div>
      `;
      a.querySelector('.mp-room-name').textContent = roomName;
      document.getElementById('room-list').appendChild(a);
    });

    const createCard = document.createElement('div');
    createCard.className = 'mp-create';
    createCard.innerHTML = '<div class="plus">+</div><div>Create a new room</div>';
    createCard.addEventListener('click', () => document.getElementById('new-room-name').focus());
    document.getElementById('room-list').appendChild(createCard);
  });

document.getElementById('new-room-name').placeholder = await api.getRandomName();
