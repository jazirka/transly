import { esc } from './dom';

/**
 * The few Markdown forms a help text may use: paragraphs, `- ` lists, `**bold**`, `` `code` `` and `[text](https://…)` links. The text is escaped first
 * and only these forms are made into tags, so help written by a plugin can never put markup (or a script) on the page.
 */
const inline = (s: string): string => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) => `<a href="${url}" data-ext-link rel="noopener noreferrer">${text}</a>`);

export function miniMarkdown(text: string): string {
  return text.replace(/\r\n/g, '\n').split(/\n{2,}/).map(block => {
    const lines = block.split('\n').filter(l => l.trim());
    if (!lines.length) return '';
    if (lines.every(l => /^\s*[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
