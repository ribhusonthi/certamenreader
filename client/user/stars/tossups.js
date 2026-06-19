import star from '../../auth/star.js';
import api from '../../api/index.js';
import { getBonusPartLabel } from '../../utilities/index.js';
import { formatAnswerline } from '../../utilities/strings.js';

const tossups = await star.getStarredTossups();
const tossupList = document.getElementById('tossup-list');

for (const tossup of tossups) {
  tossupList.innerHTML += `
        <div class="card mb-2">
            <div class="card-header d-flex justify-content-between">
                <b class="clickable" data-bs-toggle="collapse" data-bs-target="#question-${tossup._id}" aria-expanded="true">
                    ${tossup.set.name} | ${tossup.category} | ${tossup.subcategory} ${tossup.alternate_subcategory ? ' (' + tossup.alternate_subcategory + ')' : ''} | ${tossup.difficulty}
                </b>
                <a class="clickable selected" id="star-tossup-${tossup._id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
                    <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
                </svg>
                </a>
            </div>
            <div class="card-container collapse show" id="question-${tossup._id}">
                <div class="card-body">
                    <span>${tossup.question}</span>&nbsp;
                    <hr></hr>
                    <div><b>ANSWER:</b> ${formatAnswerline(tossup.formatted_answer ?? tossup.answer)}</div>
                    <div class="mt-3">
                        <button class="btn btn-sm btn-outline-secondary" id="show-boni-${tossup._id}">Show boni</button>
                        <div class="mt-2 d-none" id="bonus-for-${tossup._id}"></div>
                    </div>
                </div>
                <div class="card-footer">
                    <small class="text-muted">${tossup.packet.name ? 'Packet ' + tossup.packet.name : '&nbsp;'}</small>
                    <small class="text-muted float-end">
                        Packet ${tossup.packet.number} / Question ${tossup.number}
                    </small>
                </div>
            </div>
        </div>
    `;
}

for (const tossup of tossups) {
  document.getElementById(`star-tossup-${tossup._id}`).addEventListener('click', async function () {
    if (this.classList.contains('selected')) {
      this.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star" viewBox="0 0 16 16">
                    <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288L8 2.223l1.847 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.565.565 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z"/>
                </svg>`;
      star.unstarTossup(tossup._id);
      this.classList.toggle('selected');
    } else if (await star.starTossup(tossup._id)) {
      this.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
                    <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
                </svg>`;
      this.classList.toggle('selected');
    }
  });
}

function renderBonus (bonus) {
  if (!bonus || !bonus.parts || bonus.parts.length === 0) {
    return '<div class="text-muted">No bonus is linked to this tossup.</div>';
  }

  let cardBody = '';
  for (let i = 0; i < bonus.parts.length; i++) {
    cardBody += `
            <hr></hr>
            <p>${getBonusPartLabel(bonus, i)} ${bonus.parts[i]}</p>
            <div>ANSWER: ${formatAnswerline(bonus.answers[i])}</div>
        `;
  }

  return `
        <div class="card">
            <div class="card-body">
                <p>${bonus.leadin ?? ''}</p>
                ${cardBody}
            </div>
        </div>
    `;
}

for (const tossup of tossups) {
  const button = document.getElementById(`show-boni-${tossup._id}`);
  const container = document.getElementById(`bonus-for-${tossup._id}`);
  let loaded = false;

  button.addEventListener('click', async function () {
    // Toggle visibility once the bonus has already been fetched.
    if (loaded) {
      container.classList.toggle('d-none');
      button.textContent = container.classList.contains('d-none') ? 'Show boni' : 'Hide boni';
      return;
    }

    button.disabled = true;
    container.classList.remove('d-none');
    container.innerHTML = '<div class="text-muted">Loading…</div>';

    try {
      const bonus = await api.getBonusForTossup(
        tossup.set?.name,
        tossup.packet?.number,
        tossup.questionNumber ?? tossup.number
      );
      container.innerHTML = renderBonus(bonus);
    } catch (_error) {
      container.innerHTML = '<div class="text-danger">There was an error loading the bonus.</div>';
    }

    loaded = true;
    button.disabled = false;
    button.textContent = 'Hide boni';
  });
}
