import type { GameFile } from '../core';
import { readGameImage } from './desktop';

/** What to show for a string: a picture from the game's own files. */
export type Pic =
  | { kind: 'icon'; n: number; label: string }
  | { kind: 'face'; name: string; index: number; label: string }
  | { kind: 'enemy'; name: string; label: string }
  /** A `<Picture: name>` tag in the row's note: `img/pictures/name.png`. */
  | { kind: 'picture'; name: string; label: string };

const ICON_FILES = new Set(['Items.json', 'Weapons.json', 'Armors.json', 'Skills.json', 'States.json']);
const base = (f: string): string => f.split('/').pop() ?? f;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** The database row a key like `[7].name` points at. */
function rowOf(game: GameFile[], file: string, key: string): Record<string, unknown> | null {
  const m = /^\[(\d+)\]\./.exec(key);
  const g = game.find(x => x.name === file || base(x.name) === base(file));
  if (!m || !g || !Array.isArray(g.json)) return null;
  const r = (g.json as unknown[])[Number(m[1])];
  return isObj(r) ? r : null;
}

/** Pictures for a database row (icon, face or battler); `label` is the row's own name. */
export function picsOfRow(game: GameFile[], file: string, key: string): Pic[] {
  const r = rowOf(game, file, key);
  if (!r) return [];
  const f = base(file), label = typeof r.name === 'string' ? r.name : '';
  const out: Pic[] = [];
  if (typeof r.note === 'string') {
    for (const m of r.note.matchAll(/<\s*Picture\s*:\s*([^<>]+?)\s*>/gi)) {
      const name = m[1]!;
      if (/[\\/]/.test(name) || name.includes('..') || out.length >= 4) continue;
      out.push({ kind: 'picture', name, label: name });
    }
  }
  if (ICON_FILES.has(f) && typeof r.iconIndex === 'number' && r.iconIndex > 0) out.push({ kind: 'icon', n: r.iconIndex, label });
  else if (f === 'Actors.json' && typeof r.faceName === 'string' && r.faceName) out.push({ kind: 'face', name: r.faceName, index: Number(r.faceIndex) || 0, label });
  else if (f === 'Enemies.json' && typeof r.battlerName === 'string' && r.battlerName) out.push({ kind: 'enemy', name: r.battlerName, label });
  return out;
}

/** `Actor1#3` (the face of a message) → picture. */
export function picOfFace(face: string | undefined): Pic[] {
  const m = face ? /^(.+)#(\d+)$/.exec(face) : null;
  return m ? [{ kind: 'face', name: m[1]!, index: Number(m[2]), label: '' }] : [];
}

const cache = new Map<string, Promise<HTMLImageElement | null>>();
function load(game: string, rel: string): Promise<HTMLImageElement | null> {
  const k = `${game}\n${rel}`;
  let p = cache.get(k);
  if (!p) {
    p = readGameImage(game, rel).then(buf => new Promise<HTMLImageElement | null>(res => {
      if (!buf) return res(null);
      const url = URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    }));
    cache.set(k, p);
  }
  return p;
}

/** Draw one picture to a canvas; null when the game folder has no such file. */
export async function drawPic(game: string, pic: Pic): Promise<HTMLCanvasElement | null> {
  const c = document.createElement('canvas');
  const put = (img: HTMLImageElement, sx: number, sy: number, sw: number, sh: number, w: number, h: number): HTMLCanvasElement => {
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    if (x) { x.imageSmoothingEnabled = false; x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h); }
    return c;
  };
  if (pic.kind === 'icon') {
    const img = await load(game, 'img/system/IconSet.png');
    return img ? put(img, (pic.n % 16) * 32, Math.floor(pic.n / 16) * 32, 32, 32, 32, 32) : null;
  }
  if (pic.kind === 'picture') {
    const img = await load(game, `img/pictures/${pic.name}.png`);
    if (!img) return null;
    const k = Math.min(1, 96 / img.height);
    return put(img, 0, 0, img.width, img.height, Math.round(img.width * k), Math.round(img.height * k));
  }
  if (pic.kind === 'face') {
    const img = await load(game, `img/faces/${pic.name}.png`);
    if (!img) return null;
    const cw = img.width / 4, ch = img.height / 2;
    return put(img, (pic.index % 4) * cw, Math.floor(pic.index / 4) * ch, cw, ch, 72, 72);
  }
  const img = (await load(game, `img/enemies/${pic.name}.png`)) ?? (await load(game, `img/sv_enemies/${pic.name}.png`));
  if (!img) return null;
  const k = Math.min(1, 96 / img.height);
  return put(img, 0, 0, img.width, img.height, Math.round(img.width * k), Math.round(img.height * k));
}
