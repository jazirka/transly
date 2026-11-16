import './ui/theme.css';
import './ui/phone.css';
import './ui/app.css';
import './ui/shell.css';
import './ui/panels.css';
import './ui/states.css';
import './ui/surfaces.css';
import { toast } from './ui/dom';
import { start } from './ui/app';
import { restoreNativeChrome } from './ui/winctl';

// A failed action must never look like "nothing happened": show what went wrong.
window.addEventListener('unhandledrejection', e => { toast(`Щось пішло не так: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`); });

// If the app cannot even start, the window must not be left without a title bar.
start(document.getElementById('app')!).catch(err => {
  void restoreNativeChrome();
  toast(`Не вдалося запустити: ${err instanceof Error ? err.message : String(err)}`);
});
