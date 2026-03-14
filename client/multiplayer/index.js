import api from '../api/index.js';
import account from '../accounts.js';

const ROOM_NAME_MAX_LENGTH = 32;

// Check if user is logged in before showing multiplayer
const username = await account.getUsername();
if (!username) {
  document.querySelector('.card.shadow-sm.p-4.mb-4').innerHTML = `
    <h4 class="mb-3 text-warning fw-bold">Sign In Required</h4>
    <p class="lead">You need to be signed in to play multiplayer.</p>
    <div class="d-flex gap-3">
      <a href="/user/login" class="btn btn-primary btn-lg px-4">Log In</a>
      <a href="/user/signup" class="btn btn-outline-light btn-lg px-4">Sign Up</a>
    </div>
  `;
  // Hide the room list card
  const roomListCard = document.querySelector('.card.shadow-sm.p-4.mb-5');
  if (roomListCard) roomListCard.style.display = 'none';
} else {

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

      const a = document.createElement('a');
      a.href = `/multiplayer/${encodeURIComponent(roomName)}`;
      a.className = 'btn btn-outline-primary btn-lg text-start d-flex justify-content-between align-items-center mb-2';
      
      const titleSpan = document.createElement('span');
      titleSpan.className = 'fw-bold';
      titleSpan.textContent = roomName;
      
      const infoSpan = document.createElement('span');
      infoSpan.className = 'badge bg-primary rounded-pill fs-6';
      infoSpan.textContent = `${playerCount} player${playerCount === 1 ? '' : 's'} - ${onlineCount} online`;

      a.appendChild(titleSpan);
      a.appendChild(infoSpan);

      if (isPermanent) {
        // Handle permanent if uncommented
      } else {
        document.getElementById('room-list').appendChild(a);
      }
    });
  });

document.getElementById('new-room-name').placeholder = await api.getRandomName();

} // end of logged-in block
