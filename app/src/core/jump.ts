import type { GameFile, PageInfo } from './model';
import { pageInfo } from './rpgmaker';
import { sceneAddress } from './scene';

/** What the test plugin needs to start the game inside one scene. */
export interface JumpTarget {
  kind: 'map' | 'common';
  mapId: number;
  /** Where the player stands: the tile of the event. */
  x: number;
  y: number;
  eventIndex: number;
  eventId: number;
  page: number;
  common: number;
  /** Command to start from (0 = the beginning of the event page). */
  index: number;
  /** Save slot to start from; 0 = a new game. */
  slot: number;
  /** What the event page needs to be active (switches, variable, self-switch, item, actor): set before the start, so the scene looks as in the game. */
  setup?: Pick<PageInfo, 'switches' | 'variable' | 'selfSwitch' | 'item' | 'actor'>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Work out where to start for the row `key` of `file`. `from: 'line'` starts at that very command, `'event'` at the
 * beginning of its page. Null when the row has no scene the game can start in (battles, database rows, other formats).
 */
export function jumpTarget(file: string, key: string, game: GameFile[], from: 'line' | 'event', slot = 0): JumpTarget | null {
  const a = sceneAddress(file, key);
  if (!a || a.kind === 'troop') return null;
  const index = from === 'line' ? a.index : 0;
  if (a.kind === 'common') return { kind: 'common', mapId: 0, x: 0, y: 0, eventIndex: 0, eventId: 0, page: 0, common: a.common, index, slot };
  const events = (game.find(f => f.name === file)?.json as { events?: unknown } | undefined)?.events;
  const ev = Array.isArray(events) ? events[a.eventIndex] : undefined;
  if (!isObj(ev)) return null;
  const pg = Array.isArray(ev.pages) ? (ev.pages[a.page] as Record<string, unknown> | undefined) : undefined;
  const need = pg && typeof pg === 'object' ? pageInfo(pg, ev) : undefined;
  return {
    ...(need ? { setup: { switches: need.switches, ...(need.variable ? { variable: need.variable } : {}), ...(need.selfSwitch ? { selfSwitch: need.selfSwitch } : {}), ...(need.item ? { item: need.item } : {}), ...(need.actor ? { actor: need.actor } : {}) } } : {}),
    kind: 'map', mapId: a.mapId, x: typeof ev.x === 'number' ? ev.x : 0, y: typeof ev.y === 'number' ? ev.y : 0,
    eventIndex: a.eventIndex, eventId: typeof ev.id === 'number' ? ev.id : a.eventIndex, page: a.page, common: 0, index, slot,
  };
}

/** Name the plugin is registered under in js/plugins.js. */
export const JUMP_PLUGIN = 'TranslyJump';

/**
 * The plugin file (RPG Maker MV and MZ). It skips the title screen, puts the player on the event's map (or loads a
 * save) and, once the map is shown, runs the event page from the chosen command. Plain ES2015: old NW.js has no `?.`.
 */
export function jumpPlugin(target: JumpTarget): string {
  return `/*:
 * @plugindesc Transly: starts the game inside one scene so a translation can be checked. Added by Transly; "Повернути оригінали" removes it.
 * @author Transly
 */
(function () {
  'use strict';
  var J = ${JSON.stringify(target)};
  var armed = true;

  function complain(what) { try { console.error('Transly: ' + what); } catch (e) { /* no console */ } }

  // A fresh game has no switches on and may have an empty party: put in what the event page needs, so the
  // characters appear as they would in the game, and make sure there is someone to walk the map.
  function prepare() {
    try {
      var s = J.setup;
      if (s) {
        for (var i = 0; i < s.switches.length; i++) $gameSwitches.setValue(s.switches[i], true);
        if (s.variable && $gameVariables.value(s.variable.id) < s.variable.min) $gameVariables.setValue(s.variable.id, s.variable.min);
        if (s.selfSwitch && J.kind === 'map') $gameSelfSwitches.setValue([J.mapId, J.eventId, s.selfSwitch], true);
        if (s.item && $dataItems[s.item] && !$gameParty.hasItem($dataItems[s.item])) $gameParty.gainItem($dataItems[s.item], 1);
        if (s.actor) $gameParty.addActor(s.actor);
      }
      if ($gameParty.members().length === 0 && $dataActors[1]) $gameParty.addActor(1);
    } catch (e) { complain(String(e)); }
  }

  function enter() {
    prepare();
    if (J.kind === 'map') $gamePlayer.reserveTransfer(J.mapId, J.x, J.y, 2, 2);
    SceneManager.goto(Scene_Map);
  }

  function newGame() {
    DataManager.setupNewGame();
    enter();
  }

  function begin() {
    if (J.slot > 0) {
      try {
        var loaded = DataManager.loadGame(J.slot);
        if (loaded && typeof loaded.then === 'function') {
          loaded.then(enter, function () { complain('не вдалося завантажити збереження ' + J.slot + ', починаю нову гру'); newGame(); });
          return;
        }
        if (loaded !== false) { enter(); return; }
      } catch (e) { complain(String(e)); }
      complain('не вдалося завантажити збереження ' + J.slot + ', починаю нову гру');
    }
    newGame();
  }

  function run() {
    var list = null, eventId = 0;
    if (J.kind === 'map') {
      var ev = $dataMap.events[J.eventIndex];
      list = ev && ev.pages[J.page] ? ev.pages[J.page].list : null;
      eventId = J.eventId;
    } else {
      var ce = $dataCommonEvents[J.common];
      list = ce ? ce.list : null;
    }
    if (!list) { complain('сцену не знайдено: гра змінилася після останнього відкриття?'); return; }
    $gameMap._interpreter.setup(list, eventId);
    $gameMap._interpreter._index = Math.min(J.index, list.length - 1);
  }

  var bootStart = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    bootStart.call(this);
    begin();
  };

  var mapStart = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function () {
    mapStart.call(this);
    if (armed && (J.kind !== 'map' || $gameMap.mapId() === J.mapId)) {
      armed = false;
      run();
    }
  };
})();
`;
}
