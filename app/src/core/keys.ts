/**
 * Keys of rows come from the files of the game (a column of a table, a msgid, a name in a JSON): a key that is the name of something every
 * object has (`__proto__`, `constructor`, `toString`) would be read as that thing, or would change the object instead of being stored in it.
 * Such a key gets a `~` in front; the same function is used when the translation is written back, so the key still finds its place.
 */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'toLocaleString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
export const safeKey = (key: string): string => (RESERVED.has(key) ? `~${key}` : key);
