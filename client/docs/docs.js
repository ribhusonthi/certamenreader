// Highlight the section being read in the docs sidebar.

const links = [...document.querySelectorAll('#docs-toc a')];
const sections = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);

function setActive (id) {
  for (const a of links) {
    const on = a.getAttribute('href') === `#${id}`;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'location');
    else a.removeAttribute('aria-current');
  }
}

// The current section is the last heading above a line 30% down the viewport.
function update () {
  const line = window.innerHeight * 0.3;
  let current = sections[0];
  for (const h of sections) {
    if (h.getBoundingClientRect().top <= line) current = h;
  }
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) current = sections[sections.length - 1];
  if (current) setActive(current.id);
}

window.addEventListener('scroll', update, { passive: true });
window.addEventListener('resize', update);
update();
