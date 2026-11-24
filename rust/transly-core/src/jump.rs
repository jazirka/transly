//! `jump.ts`: з якого місця гри почати, щоб побачити рядок у сцені: де гравець стоїть, яку подію запускати й що має бути ввімкнено,
//! і сам плагін-стартер для RPG Maker MV/MZ (текст плагіна збігається з TS до символу).

use crate::model::{GameFile, PageInfo};
use crate::rpgmaker::page_info;
use crate::scene::{scene_address, SceneAddress};
use serde_json::{json, Map, Number, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JumpKind {
    Map,
    Common,
    Troop,
}
impl JumpKind {
    pub fn as_str(self) -> &'static str {
        match self {
            JumpKind::Map => "map",
            JumpKind::Common => "common",
            JumpKind::Troop => "troop",
        }
    }
}

/// Що потрібно тестовому плагіну, щоб запустити гру всередині однієї сцени.
#[derive(Clone, Debug, PartialEq)]
pub struct JumpTarget {
    pub kind: JumpKind,
    pub map_id: u64,
    /// Де стоїть гравець: клітинка події.
    pub x: Number,
    pub y: Number,
    pub event_index: u64,
    pub event_id: Number,
    pub page: u64,
    pub common: u64,
    /// Загін (бій), чия сторінка події виконується, для `Troop`.
    pub troop: u64,
    /// Команда, з якої почати (0 — початок сторінки події).
    pub index: u64,
    /// Слот збереження, з якого почати; 0 — нова гра.
    pub slot: u64,
    /// Що потрібно сторінці події, щоб бути активною: ставиться перед стартом, щоб сцена виглядала як у грі.
    pub setup: Option<PageInfo>,
}

/// Число так, як його друкує `JSON.stringify` у JS: ціле без `.0`.
fn js_number(f: f64) -> Number {
    if f.fract() == 0.0 && f.abs() < 1e15 {
        Number::from(f as i64)
    } else {
        Number::from_f64(f).unwrap_or_else(|| Number::from(0))
    }
}

impl JumpTarget {
    /// JSON з тим самим порядком полів, що й в TS (`setup` перший, коли він є).
    pub fn to_json(&self) -> Value {
        let mut m = Map::new();
        if let Some(s) = &self.setup {
            let mut st = Map::new();
            st.insert("switches".into(), json!(s.switches));
            if let Some(v) = &s.variable {
                st.insert("variable".into(), json!({ "id": v.id, "min": js_number(v.min) }));
            }
            if let Some(ss) = s.self_switch.as_deref().filter(|x| !x.is_empty()) {
                st.insert("selfSwitch".into(), json!(ss));
            }
            if let Some(i) = s.item.filter(|i| *i != 0) {
                st.insert("item".into(), json!(i));
            }
            if let Some(a) = s.actor.filter(|a| *a != 0) {
                st.insert("actor".into(), json!(a));
            }
            m.insert("setup".into(), Value::Object(st));
        }
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("mapId".into(), json!(self.map_id));
        m.insert("x".into(), Value::Number(self.x.clone()));
        m.insert("y".into(), Value::Number(self.y.clone()));
        m.insert("eventIndex".into(), json!(self.event_index));
        m.insert("eventId".into(), Value::Number(self.event_id.clone()));
        m.insert("page".into(), json!(self.page));
        m.insert("common".into(), json!(self.common));
        m.insert("troop".into(), json!(self.troop));
        m.insert("index".into(), json!(self.index));
        m.insert("slot".into(), json!(self.slot));
        Value::Object(m)
    }
}

/// З якого місця почати для рядка `key` файлу `file`. `from_line`: з самої команди, інакше з початку її сторінки. None, коли рядок не має
/// сцени, в якій гра може початися (рядки бази, інші формати). Рядок бою починає бій того загону.
pub fn jump_target(file: &str, key: &str, game: &[GameFile], from_line: bool, slot: u64) -> Option<JumpTarget> {
    let a = scene_address(file, key)?;
    let zero = || Number::from(0);
    match a {
        SceneAddress::Troop { troop, page, index } => Some(JumpTarget { kind: JumpKind::Troop, map_id: 0, x: zero(), y: zero(), event_index: 0, event_id: zero(), page, common: 0, troop, index: if from_line { index } else { 0 }, slot, setup: None }),
        SceneAddress::Common { common, index } => Some(JumpTarget { kind: JumpKind::Common, map_id: 0, x: zero(), y: zero(), event_index: 0, event_id: zero(), page: 0, common, troop: 0, index: if from_line { index } else { 0 }, slot, setup: None }),
        SceneAddress::Map { map_id, event_index, page, index } => {
            let events = game.iter().find(|f| f.name == file).and_then(|f| f.json.get("events")).and_then(Value::as_array);
            let ev = events.and_then(|e| e.get(event_index as usize)).filter(|e| e.is_object())?;
            let pg = ev.get("pages").and_then(Value::as_array).and_then(|p| p.get(page as usize)).filter(|p| p.is_object());
            let num = |k: &str, fallback: Number| ev.get(k).and_then(Value::as_f64).map_or(fallback, js_number);
            Some(JumpTarget {
                kind: JumpKind::Map,
                map_id,
                x: num("x", zero()),
                y: num("y", zero()),
                event_index,
                event_id: num("id", Number::from(event_index)),
                page,
                common: 0,
                troop: 0,
                index: if from_line { index } else { 0 },
                slot,
                setup: pg.map(|p| page_info(p, ev)),
            })
        }
    }
}

/// Назва, під якою плагін записано в js/plugins.js.
pub const JUMP_PLUGIN: &str = "TranslyJump";

/// Файл плагіна (RPG Maker MV і MZ). Він пропускає екран заголовка, ставить гравця на мапу події (чи завантажує збереження) і,
/// коли мапу показано, запускає сторінку події з обраної команди. Звичайний ES2015: старий NW.js не має `?.`.
pub fn jump_plugin(target: &JumpTarget) -> String {
    TEMPLATE.replace("@@TARGET@@", &crate::js::stringify(&target.to_json()))
}

const TEMPLATE: &str =r##"/*:
 * @plugindesc Transly: starts the game inside one scene so a translation can be checked. Added by Transly; "Повернути оригінали" removes it.
 * @author Transly
 */
(function () {
  'use strict';
  var J = @@TARGET@@;
  var armed = true;
  var armedBattle = true;

  // show: also say it in the game itself (once a map or a battle is open), so the tester sees why the start is not where it was asked for.
  function complain(what, show) {
    try { console.error('Transly: ' + what); } catch (e) { /* no console */ }
    if (show) { try { $gameMessage.add('Transly: ' + what); } catch (e) { /* no message window yet */ } }
  }

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
    else if (J.kind === 'troop') $gamePlayer.reserveTransfer($dataSystem.startMapId, $dataSystem.startX, $dataSystem.startY, 2, 2);
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

  // A battle row: fight that troop and run the chosen event page of it as soon as the battle opens.
  function battle() {
    BattleManager.setup(J.troop, false, true);
    BattleManager.onEncounter();
    SceneManager.push(Scene_Battle);
  }

  function run() {
    if (J.kind === 'troop') { battle(); return; }
    var list = null, eventId = 0;
    if (J.kind === 'map') {
      var ev = $dataMap.events[J.eventIndex];
      list = ev && ev.pages[J.page] ? ev.pages[J.page].list : null;
      eventId = J.eventId;
    } else {
      var ce = $dataCommonEvents[J.common];
      list = ce ? ce.list : null;
    }
    if (!list) { complain('сцену не знайдено: гра змінилася після останнього відкриття?', true); return; }
    $gameMap._interpreter.setup(list, eventId);
    $gameMap._interpreter._index = Math.min(J.index, list.length - 1);
  }

  // A game whose engine differs from the stock one must not end up on a black screen: say what went wrong and play on.
  function guarded(fn) { try { fn(); } catch (e) { complain('не вдалося почати зі сцени (' + String(e) + ')', true); } }

  var bootStart = Scene_Boot.prototype.start;
  Scene_Boot.prototype.start = function () {
    bootStart.call(this);
    begin();
  };

  var battleStart = Scene_Battle.prototype.start;
  Scene_Battle.prototype.start = function () {
    battleStart.call(this);
    if (J.kind !== 'troop' || !armedBattle) return;
    armedBattle = false;
    var troop = $dataTroops[J.troop], pg = troop && troop.pages[J.page];
    if (!pg) { complain('сцену не знайдено: гра змінилася після останнього відкриття?', true); return; }
    guarded(function () {
      $gameTroop._interpreter.setup(pg.list, 0);
      $gameTroop._interpreter._index = Math.min(J.index, pg.list.length - 1);
    });
  };

  var mapStart = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function () {
    mapStart.call(this);
    if (armed && (J.kind !== 'map' || $gameMap.mapId() === J.mapId)) {
      armed = false;
      guarded(run);
    }
  };
})();
"##;
