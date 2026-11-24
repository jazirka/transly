//! `ext/registry.ts`: усі плагіни, які знає застосунок, і що вони приносять. Усе, що питає «хто прочитає цей файл?» чи «який це рушій?»,
//! питає тут, тож плагін, який вимкнено, не підходить цій версії або не має потрібного, просто не питається.
//!
//! Переосмислено для рідного застосунку (плагіни лише з даних, без коду): немає слухачів змін (інтерфейс читає `revision`),
//! немає `guard` (формат за описом не може впасти по-своєму), `fail` лише записує помилку й каже, чи про неї варто повідомити.

use crate::declarative::{apply_by_spec, extract_by_spec, glob_test, FormatSpec};
use crate::engine::{base, ext, Applied};
use crate::formats::{csv, localejson, po, renpy};
use crate::i18n::{parse_catalog, CatalogData, I18n, Params, CORE};
use crate::js;
use crate::manifest::{API_VERSION, APP_VERSION};
use crate::model::{GameFile, Translations, Unit};
use crate::rpgmaker::{apply_rpgmaker, extract_rpgmaker, is_rpgmaker_file, ExtractOptions};
use crate::semver::satisfies;
use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/// Звідки плагін узявся (зберігається разом з установленим плагіном).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PluginSource {
    /// `builtin`, `github`, `url`, `file`.
    pub kind: String,
    pub location: Option<String>,
    pub r#ref: Option<String>,
    pub installed_at: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginState {
    Enabled,
    Disabled,
    Incompatible,
    MissingDependency,
    Error,
}
impl PluginState {
    pub fn as_str(self) -> &'static str {
        match self {
            PluginState::Enabled => "enabled",
            PluginState::Disabled => "disabled",
            PluginState::Incompatible => "incompatible",
            PluginState::MissingDependency => "missing-dependency",
            PluginState::Error => "error",
        }
    }
}

/// Чим саме обробник читає й пише файл.
pub enum HandlerImpl {
    RpgMaker,
    LocaleJson,
    Gettext,
    Csv,
    Renpy,
    /// Формат за описом даними (`spec` плагіна).
    Spec(FormatSpec),
}

/// Обробник формату: читає й пише один вид файлів.
pub struct FormatHandler {
    /// Унікальний у застосунку: `rpgmaker` для вбудованих, `<id плагіна>/<локальний id>` для решти.
    pub id: String,
    pub plugin: String,
    pub label: String,
    pub extensions: Vec<String>,
    pub text: bool,
    pub priority: i64,
    pub help: Option<String>,
    pub imp: HandlerImpl,
    exts: HashSet<String>,
    tests: Vec<PathTest>,
}

type PathTest = Box<dyn Fn(&str) -> bool>;

const MAX_PRIORITY: i64 = 50;

impl FormatHandler {
    #[allow(clippy::too_many_arguments)]
    pub fn new(id: &str, plugin: &str, label: &str, extensions: &[String], text: bool, priority: i64, help: Option<String>, imp: HandlerImpl, globs: &[String]) -> FormatHandler {
        FormatHandler {
            id: id.into(),
            plugin: plugin.into(),
            label: label.into(),
            extensions: extensions.to_vec(),
            text,
            priority,
            help,
            imp,
            exts: extensions.iter().map(|e| e.to_lowercase()).collect(),
            tests: globs.iter().map(|g| Box::new(glob_test(g)) as PathTest).collect(),
        }
    }

    /// Обробник формату, описаного даними: `f` — елемент `contributes.formats` перевіреного опису.
    pub fn declarative(plugin_id: &str, f: &Value) -> Option<FormatHandler> {
        let spec = crate::declarative::spec_of(f.get("spec")?)?;
        let strs = |k: &str| f.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect::<Vec<_>>()).unwrap_or_default();
        let local = f.get("id").and_then(Value::as_str).unwrap_or("");
        let priority = f.get("priority").and_then(Value::as_f64).unwrap_or(0.0).clamp(-(MAX_PRIORITY as f64), MAX_PRIORITY as f64) as i64;
        Some(FormatHandler::new(
            &format!("{plugin_id}/{local}"),
            plugin_id,
            f.get("label").and_then(Value::as_str).unwrap_or(""),
            &strs("extensions"),
            f.get("text").and_then(Value::as_bool).unwrap_or(false),
            priority,
            f.get("help").and_then(Value::as_str).filter(|h| !h.is_empty()).map(|h| format!("{plugin_id}:{h}")),
            HandlerImpl::Spec(spec),
            &strs("files"),
        ))
    }

    /// Чи бере обробник цей файл (за іменем).
    pub fn matches(&self, name: &str) -> bool {
        let b = base(name);
        let e = ext(b);
        match &self.imp {
            HandlerImpl::RpgMaker => e == ".json" && is_rpgmaker_file(b),
            HandlerImpl::LocaleJson => e == ".json" && localejson::looks_like_locale_file(name),
            HandlerImpl::Gettext => e == ".po" || e == ".pot",
            HandlerImpl::Csv => e == ".csv" || e == ".tsv",
            HandlerImpl::Renpy => e == ".rpy",
            HandlerImpl::Spec(_) => {
                if !self.exts.contains(&ext(name)) {
                    return false;
                }
                if self.tests.is_empty() {
                    return true;
                }
                let norm = name.replace('\\', "/");
                let short = norm.rsplit('/').next().unwrap_or(&norm).to_string();
                self.tests.iter().any(|t| t(&norm) || t(&short))
            }
        }
    }

    pub fn extract(&self, file: &GameFile, opts: &ExtractOptions) -> Vec<Unit> {
        let text = file.text.as_deref();
        match &self.imp {
            HandlerImpl::RpgMaker => extract_rpgmaker(&GameFile { name: base(&file.name).to_string(), ..file.clone() }, opts),
            HandlerImpl::LocaleJson => localejson::extract_locale_json(&file.json),
            HandlerImpl::Gettext => text.map_or(vec![], po::extract_po),
            HandlerImpl::Csv => text.map_or(vec![], csv::extract_csv),
            HandlerImpl::Renpy => text.map_or(vec![], renpy::extract_renpy),
            HandlerImpl::Spec(spec) => extract_by_spec(file, spec),
        }
    }

    pub fn apply(&self, file: &GameFile, tr: &Translations) -> Result<Applied, String> {
        let text = file.text.as_deref().unwrap_or("");
        Ok(match &self.imp {
            HandlerImpl::RpgMaker => Applied::Json(apply_rpgmaker(&GameFile { name: base(&file.name).to_string(), ..file.clone() }, tr)),
            HandlerImpl::LocaleJson => Applied::Json(localejson::apply_locale_json(&file.json, tr)),
            HandlerImpl::Gettext => Applied::Text(po::apply_po(text, tr)),
            HandlerImpl::Csv => Applied::Text(csv::apply_csv(text, tr)),
            HandlerImpl::Renpy => Applied::Text(renpy::apply_renpy(text, tr)),
            HandlerImpl::Spec(spec) => return apply_by_spec(file, tr, spec),
        })
    }
}

pub struct PluginRecord {
    pub manifest: Value,
    pub builtin: bool,
    /// Що обрав користувач. Чи справді плагін працює — `state`.
    pub enabled: bool,
    pub state: PluginState,
    /// Чому плагін не працює (несумісний, немає залежності, збій при завантаженні).
    pub reason: Option<String>,
    pub handlers: Vec<Rc<FormatHandler>>,
    /// Текстові файли пакета (каталоги, довідка) за шляхом.
    pub files: IndexMap<String, String>,
    pub source: PluginSource,
    /// Збій, поки плагін готувався.
    pub load_error: Option<String>,
    /// Що пішло не так, поки він працював: нова остання, не більше 20.
    pub errors: Vec<(i64, String)>,
}

impl PluginRecord {
    pub fn new(manifest: Value, builtin: bool, enabled: bool, handlers: Vec<FormatHandler>, files: IndexMap<String, String>, source: PluginSource) -> PluginRecord {
        PluginRecord { manifest, builtin, enabled, state: PluginState::Disabled, reason: None, handlers: handlers.into_iter().map(Rc::new).collect(), files, source, load_error: None, errors: vec![] }
    }
    pub fn id(&self) -> &str {
        self.manifest.get("id").and_then(Value::as_str).unwrap_or("")
    }
    fn contributes(&self, k: &str) -> Vec<Value> {
        self.manifest.get("contributes").and_then(|c| c.get(k)).and_then(Value::as_array).cloned().unwrap_or_default()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EngineInfo {
    pub plugin: String,
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub features: Vec<String>,
    pub help: Option<String>,
    pub data_folders: Vec<String>,
    pub detect: Option<Value>,
    pub formats: Vec<String>,
    pub state: PluginState,
    pub builtin: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EngineMatch {
    pub engine: EngineInfo,
    pub score: f64,
    pub matched: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HelpTopic {
    pub plugin: String,
    pub id: String,
    pub title: String,
    pub body: String,
    pub order: i64,
}

fn strs(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Чи схожі файли теки на гру за описом плагіна (`files` усі є, `anyFiles` — щонайменше `min`, `excludeFiles` жодного): наскільки
/// пасує (0..1) і які шаблони збіглися; None, коли не пасує. Шляхи порівнюються малими літерами з `/`.
pub fn match_detect(d: &Value, paths: &[String]) -> Option<(f64, Vec<String>)> {
    let files = strs(d.get("files"));
    let any_files = strs(d.get("anyFiles"));
    if files.is_empty() && any_files.is_empty() {
        return None;
    }
    let low: Vec<String> = paths.iter().map(|p| p.to_lowercase().replace('\\', "/")).collect();
    let hit = |globs: &[String]| -> Vec<String> {
        globs
            .iter()
            .filter(|g| {
                let t = glob_test(g);
                low.iter().any(|p| t(p))
            })
            .cloned()
            .collect()
    };
    if !hit(&strs(d.get("excludeFiles"))).is_empty() {
        return None;
    }
    let need = hit(&files);
    if need.len() != files.len() {
        return None;
    }
    let any = hit(&any_files);
    let min = d.get("min").and_then(Value::as_f64).unwrap_or(1.0);
    if !any_files.is_empty() && (any.len() as f64) < min {
        return None;
    }
    let total = files.len() + any_files.len();
    let score = if total > 0 { (need.len() + any.len()) as f64 / total as f64 } else { 0.0 };
    Some((score, need.into_iter().chain(any).collect()))
}

/// Id, яким решта застосунку називає те, що плагін називає локально: вбудовані лишають короткі назви.
pub fn qualified(rec: &PluginRecord, local: &str) -> String {
    if rec.builtin {
        local.to_string()
    } else {
        format!("{}/{local}", rec.id())
    }
}

const MAX_ERRORS: usize = 20;

pub struct PluginRegistry {
    recs: IndexMap<String, PluginRecord>,
    active: Vec<Rc<FormatHandler>>,
    applied: HashMap<String, String>,
    warned: HashSet<String>,
    app: Option<String>,
    api: Option<String>,
    /// Збільшується щоразу, коли набір працюючих плагінів перераховано: інтерфейс порівнює й перемальовується.
    pub revision: u64,
}

fn compat(m: &Value, app: &str, api: &str) -> Result<(), String> {
    crate::manifest::compatibility(m, app, api)
}

impl PluginRegistry {
    pub fn new(app: Option<&str>, api: Option<&str>) -> PluginRegistry {
        PluginRegistry { recs: IndexMap::new(), active: vec![], applied: HashMap::new(), warned: HashSet::new(), app: app.map(String::from), api: api.map(String::from), revision: 0 }
    }

    /// Додає плагін (або заміняє той самий id).
    pub fn add(&mut self, rec: PluginRecord, refresh: bool, i18n: &mut I18n) {
        self.recs.insert(rec.id().to_string(), rec);
        if refresh {
            self.refresh(i18n);
        }
    }

    pub fn remove(&mut self, id: &str, i18n: &mut I18n) {
        self.recs.shift_remove(id);
        i18n.remove(id);
        self.applied.remove(id);
        self.refresh(i18n);
    }

    pub fn get(&self, id: &str) -> Option<&PluginRecord> {
        self.recs.get(id)
    }
    pub fn get_mut(&mut self, id: &str) -> Option<&mut PluginRecord> {
        self.recs.get_mut(id)
    }
    pub fn list(&self) -> impl Iterator<Item = &PluginRecord> {
        self.recs.values()
    }

    pub fn set_enabled(&mut self, id: &str, on: bool, i18n: &mut I18n) {
        let Some(r) = self.recs.get_mut(id) else { return };
        if r.enabled == on {
            return;
        }
        r.enabled = on;
        self.refresh(i18n);
    }

    /// Знову з'ясовує, які плагіни працюють (потрібна версія, залежності) і що приносять працюючі.
    pub fn refresh(&mut self, i18n: &mut I18n) {
        let app = self.app.clone().unwrap_or_else(|| APP_VERSION.to_string());
        let api = self.api.clone().unwrap_or_else(|| API_VERSION.to_string());
        for r in self.recs.values_mut() {
            r.reason = None;
            if let Some(e) = r.load_error.clone() {
                r.state = PluginState::Error;
                r.reason = Some(e);
                continue;
            }
            if !r.enabled {
                r.state = PluginState::Disabled;
                continue;
            }
            match compat(&r.manifest, &app, &api) {
                Err(why) => {
                    r.state = PluginState::Incompatible;
                    r.reason = Some(why);
                }
                Ok(()) => r.state = PluginState::Enabled,
            }
        }
        // плагін працює, лише коли працює те, від чого він залежить (поки щось змінюється, тож ланцюг падає разом)
        let keys: Vec<String> = self.recs.keys().cloned().collect();
        let mut changed = true;
        let mut n = 0;
        while changed && n < 64 {
            changed = false;
            n += 1;
            for k in &keys {
                if self.recs[k].state != PluginState::Enabled {
                    continue;
                }
                let deps: Vec<(String, String)> = self.recs[k].manifest.get("dependencies").and_then(Value::as_object).map(|o| o.iter().map(|(d, r)| (d.clone(), r.as_str().unwrap_or("").to_string())).collect()).unwrap_or_default();
                for (dep, range) in deps {
                    let params = |p: &[(&str, &str)]| -> Params { p.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect() };
                    let why = match self.recs.get(&dep) {
                        None => Some(i18n.t("Потрібне розширення «{id}», його не встановлено", &params(&[("id", &dep)]), CORE)),
                        Some(d) => {
                            let name = d.manifest.get("name").and_then(Value::as_str).unwrap_or("");
                            let ver = d.manifest.get("version").and_then(Value::as_str).unwrap_or("");
                            if d.state != PluginState::Enabled {
                                Some(i18n.t("Потрібне розширення «{id}», воно не працює", &params(&[("id", name)]), CORE))
                            } else if !satisfies(ver, &range) {
                                Some(i18n.t("Потрібне розширення «{id}» версії {range}, встановлено {v}", &params(&[("id", name), ("range", &range), ("v", ver)]), CORE))
                            } else {
                                None
                            }
                        }
                    };
                    if let Some(why) = why {
                        let r = self.recs.get_mut(k).unwrap();
                        r.state = PluginState::MissingDependency;
                        r.reason = Some(why);
                        changed = true;
                        break;
                    }
                }
            }
        }
        // формати працюючих плагінів: вищий пріоритет першим, вбудовані перед рештою, далі в порядку додавання плагінів
        let order: HashMap<&str, usize> = self.recs.keys().enumerate().map(|(i, k)| (k.as_str(), i)).collect();
        let builtin = |id: &str| self.recs.get(id).is_some_and(|r| r.builtin);
        let mut active: Vec<Rc<FormatHandler>> = self.recs.values().filter(|r| r.state == PluginState::Enabled).flat_map(|r| r.handlers.iter().cloned()).collect();
        active.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| (builtin(&b.plugin) as u8).cmp(&(builtin(&a.plugin) as u8)))
                .then_with(|| order.get(a.plugin.as_str()).unwrap_or(&0).cmp(order.get(b.plugin.as_str()).unwrap_or(&0)))
        });
        self.active = active;
        self.sync_languages(i18n);
        self.revision += 1;
    }

    /// Каталоги працюючих мовних пакетів кладуться в каталог інтерфейсу, решти забираються.
    fn sync_languages(&mut self, i18n: &mut I18n) {
        let want: Vec<String> = self.recs.iter().filter(|(_, r)| r.state == PluginState::Enabled && !r.contributes("languages").is_empty()).map(|(k, _)| k.clone()).collect();
        let gone: Vec<String> = self.applied.keys().filter(|k| !want.contains(k)).cloned().collect();
        for id in gone {
            i18n.remove(&id);
            self.applied.remove(&id);
        }
        for id in want {
            let r = &self.recs[&id];
            let langs = r.contributes("languages");
            let sig = js::stringify(&json!([r.manifest.get("version"), langs, r.files.len()]));
            if self.applied.get(&id) == Some(&sig) {
                continue;
            }
            i18n.remove(&id);
            for lang in &langs {
                let mut merged = CatalogData { language: None, name: None, plural: lang.get("plural").and_then(Value::as_str).map(String::from), entries: IndexMap::new() };
                for cat in lang.get("catalogs").and_then(Value::as_array).into_iter().flatten() {
                    let file = cat.get("file").and_then(Value::as_str).unwrap_or("");
                    let Some(text) = r.files.get(file) else { continue };
                    let data = parse_catalog(file, text);
                    if merged.plural.is_none() {
                        merged.plural = data.plural.clone();
                    }
                    let ctx = cat.get("context").and_then(Value::as_str).filter(|c| !c.is_empty());
                    for (k, v) in data.entries {
                        // файл, обмежений одним контекстом, тримає свої записи там; файл без обмеження — контексти, що названі в записах
                        let key = match (ctx, k.find('\u{4}')) {
                            (Some(c), Some(at)) if &k[..at] == "core" => format!("{c}\u{4}{}", &k[at + 1..]),
                            _ => k,
                        };
                        merged.entries.insert(key, v);
                    }
                }
                let code = lang.get("code").and_then(Value::as_str).unwrap_or("");
                let name = lang.get("nativeName").and_then(Value::as_str).or_else(|| lang.get("name").and_then(Value::as_str));
                i18n.add(code, merged, &id, name);
            }
            self.applied.insert(id, sig);
        }
    }

    // ---------- формати ----------

    /// Обробник файлу, або None, коли жоден працюючий плагін його не читає.
    pub fn handler_of(&self, name: &str) -> Option<Rc<FormatHandler>> {
        self.active.iter().find(|h| h.matches(name)).cloned()
    }
    pub fn handler(&self, id: Option<&str>) -> Option<Rc<FormatHandler>> {
        let id = id?;
        self.active.iter().find(|h| h.id == id).cloned()
    }
    pub fn formats(&self) -> Vec<Rc<FormatHandler>> {
        self.active.clone()
    }
    /// Розширення файлів, які застосунок уміє читати зараз.
    pub fn extensions(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        self.active.iter().flat_map(|h| h.extensions.iter()).filter(|e| seen.insert((*e).clone())).cloned().collect()
    }
    /// Чи належить обробник плагіну, що йде із застосунком (його відповідям вірять як є).
    pub fn is_builtin_handler(&self, h: &FormatHandler) -> bool {
        self.recs.get(&h.plugin).is_some_and(|r| r.builtin)
    }

    /// Записує помилку плагіна. Повертає true, коли про такий вид збою ще не повідомляли (інтерфейс покаже її користувачеві).
    pub fn fail(&mut self, plugin: &str, what: &str, now: i64) -> bool {
        let Some(rec) = self.recs.get_mut(plugin) else { return false };
        rec.errors.push((now, what.to_string()));
        if rec.errors.len() > MAX_ERRORS {
            rec.errors.remove(0);
        }
        static DIGITS: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new(r"\d+").unwrap());
        let key = format!("{plugin}\0{}", DIGITS.replace_all(what, "#"));
        self.warned.insert(key)
    }

    // ---------- рушії ----------

    pub fn engines(&self) -> Vec<EngineInfo> {
        let mut out = Vec::new();
        for r in self.recs.values() {
            for e in r.contributes("engines") {
                let s = |k: &str| e.get(k).and_then(Value::as_str).map(String::from);
                out.push(EngineInfo {
                    plugin: r.id().to_string(),
                    id: qualified(r, e.get("id").and_then(Value::as_str).unwrap_or("")),
                    label: s("label").unwrap_or_default(),
                    description: s("description"),
                    features: strs(e.get("features")),
                    help: s("help").filter(|h| !h.is_empty()).map(|h| format!("{}:{h}", r.id())),
                    data_folders: strs(e.get("dataFolders")),
                    detect: e.get("detect").cloned(),
                    formats: strs(e.get("formats")).iter().map(|f| qualified(r, f)).collect(),
                    state: r.state,
                    builtin: r.builtin,
                });
            }
        }
        out
    }

    /// На які рушії схожі файли обраної теки (найкращі першими). Вимкнені плагіни враховуються: відповідь на «що це?» від цього не залежить.
    pub fn detect(&self, paths: &[String]) -> Vec<EngineMatch> {
        let mut out: Vec<EngineMatch> = Vec::new();
        for engine in self.engines() {
            let m = engine.detect.as_ref().and_then(|d| match_detect(d, paths));
            if let Some((score, matched)) = m {
                out.push(EngineMatch { engine, score, matched });
            }
        }
        out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    /// Можливості, які пропонують рушії працюючих плагінів.
    pub fn features(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        self.engines().into_iter().filter(|e| e.state == PluginState::Enabled).flat_map(|e| e.features).filter(|f| seen.insert(f.clone())).collect()
    }

    // ---------- довідка ----------

    /// Теми довідки місця (`general` або `engine:<id>`) працюючих плагінів.
    pub fn help(&self, topic: &str) -> Vec<HelpTopic> {
        let mut out = Vec::new();
        for r in self.recs.values() {
            if r.state != PluginState::Enabled {
                continue;
            }
            for h in r.contributes("help") {
                if h.get("topic").and_then(Value::as_str).unwrap_or("general") != topic {
                    continue;
                }
                let Some(body) = help_body(r, &h) else { continue };
                out.push(HelpTopic {
                    plugin: r.id().to_string(),
                    id: h.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
                    title: h.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
                    body,
                    order: h.get("order").and_then(Value::as_i64).unwrap_or(0),
                });
            }
        }
        out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| crate::collate::locale_compare(&a.title, &b.title)));
        out
    }

    /// Одна тема за id, що його називає рушій (`<плагін>:<id>`), де б її не показували.
    pub fn help_by_id(&self, r#ref: &str) -> Option<HelpTopic> {
        let at = r#ref.find(':')?;
        let (plugin, id) = (&r#ref[..at], &r#ref[at + 1..]);
        let r = self.recs.get(plugin)?;
        let h = r.contributes("help").into_iter().find(|x| x.get("id").and_then(Value::as_str) == Some(id))?;
        let body = help_body(r, &h)?;
        Some(HelpTopic { plugin: plugin.into(), id: id.into(), title: h.get("title").and_then(Value::as_str).unwrap_or("").into(), body, order: h.get("order").and_then(Value::as_i64).unwrap_or(0) })
    }

    /// Текст файла пакета (каталог, сторінка довідки).
    pub fn read(&self, plugin: &str, path: &str) -> Option<&String> {
        self.recs.get(plugin)?.files.get(path)
    }
}

/// `body ?? (file ? files.get(file) : undefined)`.
fn help_body(r: &PluginRecord, h: &Value) -> Option<String> {
    match h.get("body").filter(|b| !b.is_null()) {
        Some(b) => b.as_str().map(String::from),
        None => h.get("file").and_then(Value::as_str).filter(|f| !f.is_empty()).and_then(|f| r.files.get(f)).cloned(),
    }
}
