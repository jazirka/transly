import { b64 } from '../core';

/** What the Android app (see android/) puts on the page. Absent in a browser, in Tauri and in an artifact. */
export interface AndroidBridge {
  setStats?(json: string): void;
  beginSave?(name: string, mime: string): boolean;
  saveChunk?(base64: string): boolean;
  endSave?(): boolean;
}

export const androidBridge = (): AndroidBridge | null => (window as unknown as { TranslyAndroid?: AndroidBridge }).TranslyAndroid ?? null;

export interface WidgetStats { name: string; file: string; total: number; approved: number; done: number; draft: number; /** The next untranslated row of the open file, for the "next line" widget. */ next?: { file: string; key: string; text: string } }

let timer: ReturnType<typeof setTimeout> | undefined;
let last = '';

/** Numbers for the home-screen widget. Sent a moment after the last change, and only when they changed. */
export function publishWidget(stats: WidgetStats): void {
  const bridge = androidBridge();
  if (!bridge?.setStats) return;
  const json = JSON.stringify(stats);
  if (json === last) return;
  last = json;
  clearTimeout(timer);
  timer = setTimeout(() => bridge.setStats?.(json), 1500);
}

/** 3 × 256 KiB: a multiple of 3 bytes, so every piece encodes to base64 without padding in the middle of the file. */
const PIECE = 3 * 256 * 1024;

/** Save a file to the phone's Downloads folder through the app, piece by piece. */
export async function saveViaAndroid(bridge: AndroidBridge, name: string, data: Blob, mime: string): Promise<boolean> {
  if (!bridge.beginSave || !bridge.saveChunk || !bridge.endSave || !bridge.beginSave(name, mime)) return false;
  for (let at = 0; at < data.size; at += PIECE) {
    const bytes = new Uint8Array(await data.slice(at, at + PIECE).arrayBuffer());
    if (!bridge.saveChunk(b64(bytes))) return false;
  }
  return bridge.endSave();
}
