import { invoke } from '@tauri-apps/api/core';
import { RELEASE_TAG, parseRelease, pickAsset, platformOf, updateAvailable, withTimeout } from '../core';
import type { Platform, ReleaseAsset, ReleaseInfo } from '../core';
import { androidBridge } from './android';
import { isDesktop } from './desktop';
import { $, toast } from './dom';
import { dialog } from './settings';

/** Updates of the Android and desktop apps: the latest release of the (private) repository, read with the user's token. */
export interface UpdateConfig {
  /** A fine-grained token with read access to the repository's contents. Stays on this device. */
  token: string;
  repo: string;
  /** Look for an update when the app starts. */
  auto: boolean;
  /** The release the user said "not now" to, so it is not offered again at every start. */
  skipped: string;
}

const KEY = 'transly-update';

export function loadUpdateConfig(): UpdateConfig {
  const blank: UpdateConfig = { token: '', repo: 'jazirka/transly', auto: true, skipped: '' };
  try { return { ...blank, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UpdateConfig>) }; } catch { return blank; }
}
export function saveUpdateConfig(c: UpdateConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
}

/** Where this app runs; null in a browser or an artifact, which update themselves by reloading. */
export const updatePlatform = (): Platform | null => platformOf(!!androidBridge()?.installUpdate, isDesktop(), navigator.userAgent);

export interface UpdateCheck { platform: Platform; release: ReleaseInfo; asset: ReleaseAsset | null; newer: boolean; page: string }

export async function checkForUpdate(cfg: UpdateConfig, fetchFn: typeof fetch = fetch): Promise<UpdateCheck> {
  const platform = updatePlatform();
  if (!platform) throw new Error('Оновлення працюють у застосунку для Android і в настільному застосунку');
  if (!cfg.token.trim()) throw new Error('Вставте токен GitHub з правом читання репозиторію');
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo.trim())) throw new Error('Репозиторій вкажіть як «власник/назва»');
  const tag = RELEASE_TAG[platform];
  let r: Response;
  try {
    r = await fetchFn(`https://api.github.com/repos/${cfg.repo.trim()}/releases/tags/${tag}`, withTimeout({ headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${cfg.token.trim()}` } }));
  } catch { throw new Error('Немає з’єднання з GitHub'); }
  if (r.status === 401) throw new Error('Токен недійсний або прострочений');
  if (r.status === 404) throw new Error('Релізу ще немає, або токен не має доступу до цього репозиторію');
  if (!r.ok) throw new Error(`GitHub: помилка ${r.status}`);
  const release = parseRelease(await r.json());
  if (!release) throw new Error('GitHub надіслав незрозумілу відповідь');
  return { platform, release, asset: pickAsset(platform, release.assets), newer: updateAvailable(__BUILD_ID__, release.sha, release.published, __BUILD_TIME__), page: `https://github.com/${cfg.repo.trim()}/releases/tag/${tag}` };
}

/** Hand the installer to the app: Android downloads it and opens the system installer, Windows runs it and closes. */
export async function installUpdate(cfg: UpdateConfig, c: UpdateCheck, onState: (stage: string, text: string) => void): Promise<void> {
  if (!c.asset) throw new Error('У релізі немає файлу для цієї системи');
  if (c.platform === 'android') {
    (window as unknown as { __updateState?: typeof onState }).__updateState = onState;
    androidBridge()!.installUpdate!(c.asset.url, cfg.token.trim(), c.asset.digest ?? '', c.asset.size);
    return;
  }
  if (c.platform !== 'windows') throw new Error(`Автоматичне встановлення поки є лише в Windows і Android. Завантажте файл зі сторінки релізу: ${c.page}`);
  onState('download', 'Завантажую оновлення…');
  await invoke('install_update', { url: c.asset.url, token: cfg.token.trim(), name: c.asset.name });
  onState('install', 'Запускаю встановлення, застосунок зараз закриється');
}

/** "A new version is available": download and install it, or not now. */
export function openUpdateDialog(cfg: UpdateConfig, c: UpdateCheck): void {
  const when = c.release.published ? new Date(c.release.published).toLocaleString('uk-UA') : '';
  const dlg = dialog(`<form method="dialog"><h2 id="up-t">Є нова версія</h2>
    <p class="hint">Опубліковано ${when || 'нещодавно'}. ${c.asset ? `Файл: ${c.asset.name}${c.asset.size ? ` (${Math.round(c.asset.size / 1048576 * 10) / 10} МБ)` : ''}.` : 'Для цієї системи файлу в релізі немає.'} Ваш переклад зберігається, встановлення його не торкається.</p>
    <p class="sum" id="up-state" role="status" hidden></p>
    <div class="acts"><button class="btn" value="cancel" id="up-no">Не зараз</button><button class="btn p" type="button" id="up-go" ${c.asset ? '' : 'disabled'}>Завантажити й встановити</button></div></form>`, 'up-t');
  const state = (stage: string, text: string) => { const s = $('#up-state', dlg); s.hidden = false; s.textContent = text; s.classList.toggle('bad', stage === 'error' || stage === 'permission'); ($('#up-go', dlg) as HTMLButtonElement).disabled = stage === 'download' || stage === 'install'; };
  $('#up-no', dlg).addEventListener('click', () => { saveUpdateConfig({ ...cfg, skipped: c.release.sha }); });
  $('#up-go', dlg).addEventListener('click', async () => {
    state('download', 'Починаю…');
    try { await installUpdate(cfg, c, state); } catch (e) { state('error', e instanceof Error ? e.message : String(e)); }
  });
}

/** At start: look for an update quietly; only a new, not yet declined version interrupts. */
export async function autoCheck(): Promise<void> {
  const cfg = loadUpdateConfig();
  if (!updatePlatform() || !cfg.auto || !cfg.token.trim()) return;
  try {
    const c = await checkForUpdate(cfg);
    if (c.newer && c.release.sha !== cfg.skipped && !document.querySelector('dialog[open]')) openUpdateDialog(cfg, c);
  } catch { /* offline or a bad token: said in Settings when the user checks by hand */ }
}

/** Settings: the section's markup and wiring. Hidden where updates do not apply. */
export function updateSectionHtml(cfg: UpdateConfig): string {
  return `<details id="up-sec" ${updatePlatform() ? '' : 'hidden'}><summary>Оновлення застосунку</summary>
    <p class="hint">Застосунок може сам знаходити нову збірку в релізах приватного репозиторію. Потрібен токен лише для читання: GitHub → Settings → Developer settings → Fine-grained tokens → доступ до репозиторію <b>${cfg.repo}</b>, право «Contents: Read-only». Токен лишається на цьому пристрої.</p>
    <div class="grid"><label for="up-repo">Репозиторій зі збірками</label><input id="up-repo" autocomplete="off" spellcheck="false" value="${cfg.repo}">
      <label for="up-token">Токен (лише читання)</label><input id="up-token" type="password" autocomplete="off" value="${cfg.token}"></div>
    <label class="achk"><input type="checkbox" id="up-auto" ${cfg.auto ? 'checked' : ''}> Шукати оновлення під час запуску</label>
    <div class="acts l"><button class="btn p" type="button" id="up-check">Перевірити оновлення зараз</button></div>
    <p class="hint" id="up-status" role="status">Версія збірки: ${__BUILD_ID__ === 'dev' ? 'локальна' : __BUILD_ID__.slice(0, 7)}</p></details>`;
}

export function wireUpdateSection(dlg: HTMLDialogElement): void {
  const cfg = loadUpdateConfig();
  const read = (): UpdateConfig => ({ ...cfg, repo: ($('#up-repo', dlg) as HTMLInputElement).value.trim(), token: ($('#up-token', dlg) as HTMLInputElement).value.trim(), auto: ($('#up-auto', dlg) as HTMLInputElement).checked });
  dlg.querySelector('#up-sec')?.addEventListener('change', () => { Object.assign(cfg, read()); saveUpdateConfig(cfg); });
  dlg.querySelector('#up-check')?.addEventListener('click', async () => {
    Object.assign(cfg, read(), { skipped: '' }); saveUpdateConfig(cfg);
    const status = $('#up-status', dlg);
    status.textContent = 'Перевіряю…';
    try {
      const c = await checkForUpdate(cfg);
      if (c.newer) { status.textContent = 'Є нова версія.'; dlg.close(); openUpdateDialog(cfg, c); }
      else { status.textContent = 'У вас остання версія.'; toast('У вас остання версія'); }
    } catch (e) { status.textContent = e instanceof Error ? e.message : 'Не вдалося перевірити'; }
  });
}
