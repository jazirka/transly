/** A request that gets no answer is given up after this long (a network that takes the connection and says nothing would otherwise hold the sync button for ever). */
export const REQUEST_TIMEOUT_MS = 30_000;

/** `init` with a signal that aborts after `ms` (where the browser can do that; elsewhere the request runs as before). */
export function withTimeout(init: RequestInit = {}, ms: number = REQUEST_TIMEOUT_MS): RequestInit {
  if (init.signal || typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return init;
  return { ...init, signal: AbortSignal.timeout(ms) };
}

/** True for the error a timed-out or cancelled request throws. */
export const isTimeout = (e: unknown): boolean => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

/** The sentence for a request that was given up. */
export const timeoutMessage = (what: string): string => `${what} не відповів за ${Math.round(REQUEST_TIMEOUT_MS / 1000)} с: перевірте з’єднання й спробуйте ще раз`;
