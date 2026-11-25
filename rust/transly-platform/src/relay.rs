//! Синхронізація між власними пристроями через реле (`app/src/core/{crypto,sync}.ts`, `app/server/relay.ts`):
//! наскрізне шифрування (PBKDF2 → AES-256-GCM, перед цим gzip), реле бачить лише байти й ідентифікатор кімнати.
//! Формат байтів збігається з TS: 12 байт IV, далі шифротекст із тегом.

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use sha2::Sha256;
use std::io::{Read, Write};
use transly_core::project::{deserialize, merge_projects, serialize, SavedProject};

const ITER: u32 = 200_000;

pub struct SyncKeys {
    key: [u8; 32],
    pub room: String,
}

/// Ключ AES і ідентифікатор кімнати з паролю: той самий пароль дає ту саму кімнату на кожному пристрої.
pub fn derive_keys(passphrase: &str) -> Result<SyncKeys, String> {
    if passphrase.chars().count() < 8 {
        return Err("Пароль синхронізації має містити щонайменше 8 символів".into());
    }
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), b"transly-sync-v1:key", ITER, &mut key);
    let mut room = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), b"transly-sync-v1:room", ITER, &mut room);
    Ok(SyncKeys { key, room: room.iter().map(|b| format!("{b:02x}")).collect() })
}

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    let _ = e.write_all(data);
    e.finish().unwrap_or_default()
}

fn gunzip(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(data).read_to_end(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

/// Стискає й шифрує: 12 байт IV, далі шифротекст.
pub fn seal(keys: &SyncKeys, text: &str) -> Vec<u8> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&keys.key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher.encrypt(&nonce, gzip(text.as_bytes()).as_slice()).unwrap_or_default();
    let mut out = nonce.to_vec();
    out.extend(ct);
    out
}

pub fn open(keys: &SyncKeys, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 29 {
        return Err("Дані синхронізації пошкоджено".into());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&keys.key));
    let plain = cipher.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]).map_err(|_| "Не вдалося розшифрувати дані: перевірте пароль синхронізації".to_string())?;
    let text = gunzip(&plain).map_err(|_| "Не вдалося розшифрувати дані: перевірте пароль синхронізації".to_string())?;
    String::from_utf8(text).map_err(|_| "Дані синхронізації пошкоджено".to_string())
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Blob {
    Data,
    Snap,
}

impl Blob {
    fn path(self) -> &'static str {
        match self {
            Blob::Data => "data",
            Blob::Snap => "snap",
        }
    }
}

/// Що пропонує реле. `etag` змінюється при кожному записі; `put` з несвіжим `if_match` дає `Ok(None)` (конфлікт).
pub trait Transport {
    fn get(&mut self, room: &str, kind: Blob) -> Result<Option<(String, Vec<u8>)>, String>;
    fn put(&mut self, room: &str, kind: Blob, bytes: &[u8], if_match: Option<&str>) -> Result<Option<String>, String>;
}

/// Реле по HTTP (`server/relay.ts`): `GET/PUT {base}/r/{room}/{data|snap}`.
pub struct HttpTransport {
    base: String,
    agent: ureq::Agent,
}

impl HttpTransport {
    pub fn new(base: &str) -> HttpTransport {
        let agent = ureq::AgentBuilder::new().user_agent("transly").timeout(std::time::Duration::from_secs(30)).build();
        HttpTransport { base: base.trim_end_matches('/').to_string(), agent }
    }
    fn url(&self, room: &str, kind: Blob) -> String {
        format!("{}/r/{room}/{}", self.base, kind.path())
    }
}

fn timeout_note(e: ureq::Error) -> String {
    match e {
        ureq::Error::Transport(t) if t.kind() == ureq::ErrorKind::Io || t.to_string().to_lowercase().contains("timed out") => "Сервер синхронізації не відповів за 30 с: перевірте адресу й з’єднання".into(),
        other => format!("Сервер синхронізації: {other}"),
    }
}

impl Transport for HttpTransport {
    fn get(&mut self, room: &str, kind: Blob) -> Result<Option<(String, Vec<u8>)>, String> {
        match self.agent.get(&self.url(room, kind)).call() {
            Ok(r) => {
                let etag = r.header("ETag").unwrap_or("").to_string();
                let mut bytes = Vec::new();
                r.into_reader().read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                Ok(Some((etag, bytes)))
            }
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(ureq::Error::Status(code, _)) => Err(format!("Сервер синхронізації: не вдалося отримати дані ({code})")),
            Err(e) => Err(timeout_note(e)),
        }
    }

    fn put(&mut self, room: &str, kind: Blob, bytes: &[u8], if_match: Option<&str>) -> Result<Option<String>, String> {
        let mut req = self.agent.put(&self.url(room, kind));
        if let Some(m) = if_match {
            req = req.set("If-Match", m);
        }
        match req.send_bytes(bytes) {
            Ok(r) => Ok(Some(r.header("ETag").unwrap_or("").to_string())),
            Err(ureq::Error::Status(412, _)) => Ok(None),
            Err(ureq::Error::Status(code, _)) => Err(format!("Сервер синхронізації: не вдалося надіслати дані ({code})")),
            Err(e) => Err(timeout_note(e)),
        }
    }
}

pub struct SyncReport {
    pub project: SavedProject,
    pub pulled: bool,
    pub pushed: bool,
    pub conflicts: usize,
    pub dropped_by_reset: usize,
    /// Оригінальні рядки отримано з реле (на цьому пристрої їх не було).
    pub got_snapshot: bool,
}

/// Дані перекладача без великого знімка гри й довідкової мови.
fn lite(p: &SavedProject) -> SavedProject {
    let mut q = p.clone();
    q.snapshot = None;
    q.reference = None;
    q
}

fn assets_of(p: &SavedProject) -> SavedProject {
    let mut q = lite(p);
    q.snapshot = p.snapshot.clone();
    q.reference = p.reference.clone();
    q
}

/// Один обмін: завантажити спільну копію, злити з нашою (новіша правка кожного рядка перемагає), вивантажити результат.
/// Повторює, коли інший пристрій писав між нашими запитами. Великі ресурси гри їдуть окремим блоком і лише коли ревізія інша.
pub fn sync_once(t: &mut dyn Transport, keys: &SyncKeys, local: &SavedProject, since: i64, now: i64) -> Result<SyncReport, String> {
    let mut project = local.clone();
    let (mut got_snapshot, mut pulled, mut conflicts, mut dropped) = (false, false, 0usize, 0usize);
    for _ in 0..4 {
        let remote = t.get(&keys.room, Blob::Data)?;
        let mut etag: Option<String> = None;
        let mut their_rev = 0;
        if let Some((tag, bytes)) = remote {
            let theirs = deserialize(&open(keys, &bytes)?, Some(now))?;
            their_rev = theirs.assets_rev.unwrap_or(0);
            let m = merge_projects(&project, &theirs, since);
            conflicts += m.conflicts.len();
            dropped += m.dropped_by_reset;
            project = m.project;
            etag = Some(tag);
            pulled = true;
        }
        let my_rev = local.assets_rev.unwrap_or(0);
        if their_rev > my_rev && !got_snapshot {
            if let Some((_, bytes)) = t.get(&keys.room, Blob::Snap)? {
                let a = deserialize(&open(keys, &bytes)?, Some(now))?;
                if a.snapshot.is_some() {
                    project.snapshot = a.snapshot;
                }
                if a.reference.is_some() {
                    project.reference = a.reference;
                }
                project.assets_rev = Some(their_rev);
                got_snapshot = true;
            }
        } else if my_rev > their_rev && (project.snapshot.is_some() || project.reference.is_some()) {
            let body = seal(keys, &serialize(&assets_of(&project)));
            if t.put(&keys.room, Blob::Snap, &body, None)?.is_none() {
                let cur = t.get(&keys.room, Blob::Snap)?;
                t.put(&keys.room, Blob::Snap, &body, cur.as_ref().map(|c| c.0.as_str()))?;
            }
        }
        if t.put(&keys.room, Blob::Data, &seal(keys, &serialize(&lite(&project))), etag.as_deref())?.is_some() {
            return Ok(SyncReport { project, pulled, pushed: true, conflicts, dropped_by_reset: dropped, got_snapshot });
        }
    }
    Err("Не вдалося синхронізувати: інший пристрій постійно змінює дані. Спробуйте ще раз".into())
}

/// Чому адреса не може бути адресою сервера (None, коли може): перевіряється до запиту, щоб помилку в адресі не прийняли за хибний пароль.
pub fn url_problem(url: &str) -> Option<&'static str> {
    let t = url.trim();
    if t.is_empty() {
        return Some("Вкажіть адресу сервера");
    }
    match url::Url::parse(t) {
        Ok(u) if u.scheme() == "https" || u.scheme() == "http" => None,
        _ => Some("Адреса сервера має починатися з https:// (для власної мережі можна http://)"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use transly_core::project::empty_project;

    /// Реле в пам'яті з тією ж поведінкою ETag, що й `server/relay.ts`.
    #[derive(Default)]
    struct Fake {
        store: HashMap<String, (u64, Vec<u8>)>,
        n: u64,
    }

    impl Transport for Fake {
        fn get(&mut self, room: &str, kind: Blob) -> Result<Option<(String, Vec<u8>)>, String> {
            Ok(self.store.get(&format!("{room}/{}", kind.path())).map(|(e, b)| (format!("\"{e}\""), b.clone())))
        }
        fn put(&mut self, room: &str, kind: Blob, bytes: &[u8], if_match: Option<&str>) -> Result<Option<String>, String> {
            let k = format!("{room}/{}", kind.path());
            if let (Some(m), Some((e, _))) = (if_match, self.store.get(&k)) {
                if m != format!("\"{e}\"") {
                    return Ok(None);
                }
            }
            self.n += 1;
            self.store.insert(k, (self.n, bytes.to_vec()));
            Ok(Some(format!("\"{}\"", self.n)))
        }
    }

    #[test]
    fn keys_and_bytes_match_the_ts_code() {
        let k = derive_keys("correct horse battery").unwrap();
        assert_eq!(k.room, "64e25e972b46e515afcff2483ea83e91f5e447a1b2cd9bd68d39b0bd8ef78b7f");
        // байти, запечатані справжнім TS-кодом (WebCrypto)
        use base64::Engine;
        let sealed = base64::engine::general_purpose::STANDARD.decode("M4mrXo5K2J9S8VLwFyvvypi9I6LvQj2weWM0q7PRw7jhxoIHzHje++gLn/js2wU6hFEhXV+Rc0aQlqp/h9XhYl/hLA1rZfVyR94K14sqJ/e3").unwrap();
        assert_eq!(open(&k, &sealed).unwrap(), "Привіт, світе — {\"a\":1}");
        assert_eq!(open(&k, &seal(&k, "туди й назад")).unwrap(), "туди й назад");
        assert!(open(&derive_keys("another passphrase").unwrap(), &sealed).unwrap_err().contains("пароль"));
        assert!(derive_keys("short").is_err());
    }

    #[test]
    fn two_devices_meet_through_the_relay() {
        let keys = derive_keys("correct horse battery").unwrap();
        let mut relay = Fake::default();
        let mut a = empty_project("p", "en", "uk");
        a.terms.push(serde_json::json!({"en":"Hero","uk":"Герой","mt":1000}));
        let ra = sync_once(&mut relay, &keys, &a, 0, 1000).unwrap();
        assert!(ra.pushed && !ra.pulled);
        // другий пристрій отримує глосарій першого й додає свій термін
        let mut b = empty_project("p", "en", "uk");
        b.terms.push(serde_json::json!({"en":"Mage","uk":"Маг","mt":1100}));
        let rb = sync_once(&mut relay, &keys, &b, 0, 2000).unwrap();
        assert!(rb.pulled);
        assert_eq!(rb.project.terms.len(), 2, "терміни обох пристроїв");
        // перший пристрій на наступному обміні бачить термін другого
        let ra2 = sync_once(&mut relay, &keys, &ra.project, 0, 3000).unwrap();
        assert_eq!(ra2.project.terms.len(), 2);
        // чужий пароль розкриває лише повідомлення про пароль
        let other = derive_keys("totally different one").unwrap();
        assert_ne!(other.room, keys.room, "інший пароль — інша кімната");
    }

    #[test]
    fn urls_are_checked_before_any_request() {
        assert!(url_problem("").is_some());
        assert!(url_problem("not a url").is_some());
        assert!(url_problem("ftp://x").is_some());
        assert!(url_problem("https://relay.example").is_none());
        assert!(url_problem("http://192.168.0.5:7421").is_none());
    }
}
