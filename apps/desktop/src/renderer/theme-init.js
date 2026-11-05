/* global localStorage, document */
// Aplica el tema guardado antes de pintar, para evitar el parpadeo (R21.1).
try {
  const t = localStorage.getItem('orq-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch {
  // sin almacenamiento: manda el tema del sistema
}
