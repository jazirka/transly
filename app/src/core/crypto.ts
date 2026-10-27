/** End-to-end encryption for sync: the relay only ever sees opaque bytes and a room id. WebCrypto (browser and Node 22). */
const enc = new TextEncoder();
const ITER = 200_000;

const toHex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

export interface SyncKeys { key: CryptoKey; room: string }

/** Derive the AES key and the room id from the shared passphrase. Same passphrase → same room on every device. */
export async function deriveKeys(passphrase: string): Promise<SyncKeys> {
  if (passphrase.length < 8) throw new Error('Пароль синхронізації має містити щонайменше 8 символів');
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const salt = (label: string) => enc.encode('transly-sync-v1:' + label);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt('key'), iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const roomBits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt('room'), iterations: ITER }, base, 256);
  return { key, room: toHex(roomBits) };
}

/** Compress, then encrypt. Output: 12-byte IV followed by ciphertext. */
export async function seal(keys: SyncKeys, text: string): Promise<Uint8Array> {
  const packed = await gzip(enc.encode(text));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.key, packed as BufferSource));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return out;
}

export async function open(keys: SyncKeys, bytes: Uint8Array): Promise<string> {
  if (bytes.length < 29) throw new Error('Дані синхронізації пошкоджено');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, keys.key, bytes.slice(12) as BufferSource);
    return new TextDecoder().decode(await gunzip(new Uint8Array(plain)));
  } catch {
    throw new Error('Не вдалося розшифрувати дані: перевірте пароль синхронізації');
  }
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}
const gzip = (d: Uint8Array) => pipe(d, new CompressionStream('gzip'));
const gunzip = (d: Uint8Array) => pipe(d, new DecompressionStream('gzip'));
