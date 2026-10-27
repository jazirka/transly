import './ui/theme.css';
import './ui/phone.css';
import './ui/app.css';
import { toast } from './ui/dom';
import { start } from './ui/app';

// A failed action must never look like "nothing happened": show what went wrong.
window.addEventListener('unhandledrejection', e => { toast(`Щось пішло не так: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`); });

start(document.getElementById('app')!);
