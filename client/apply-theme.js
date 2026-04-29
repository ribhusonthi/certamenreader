function preferredColorTheme () {
  const storedTheme = window.localStorage.getItem('color-theme');
  if (storedTheme === 'dark' || storedTheme === 'light') return storedTheme;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function applyColorTheme (theme = preferredColorTheme()) {
  const stylesheet = document.querySelector('#custom-css');
  if (!stylesheet) return;
  stylesheet.setAttribute('href', `/bootstrap/${theme}.css`);
  document.documentElement.dataset.colorTheme = theme;
}

applyColorTheme();

export { applyColorTheme, preferredColorTheme };
