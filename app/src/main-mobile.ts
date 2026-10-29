import './mobile/mobile.css';
import { start } from './mobile/app';

// Phone app entry: its own shell and styles; only src/core and a few storage/sync helpers are shared with the desktop app.
window.addEventListener('unhandledrejection', e => {
  const t = document.getElementById('m-toasts'); if (!t) return;
  const d = document.createElement('div'); d.className = 'm-toast bad'; d.textContent = `Щось пішло не так: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`; t.appendChild(d); setTimeout(() => d.remove(), 6000);
});
void start(document.getElementById('app')!);
