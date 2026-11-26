//! Оновлення нативного застосунку: один `Transly-native.exe` без встановлення (рішення власника). Знаходить останній
//! реліз `rust-latest`, завантажує файл із перевіркою контрольної суми й підміняє ним працюючий `.exe` після закриття.
//! Основа — те саме, що в оновленні старого застосунку (`download_asset`, `allowed_update`, `update_available` ядра).

use crate::{allowed_update, download_asset, ps_quote};
use std::path::{Path, PathBuf};
use transly_core::update::{parse_release, update_available, ReleaseInfo};

/// Тег релізу, під яким CI публікує нативну збірку.
pub const NATIVE_TAG: &str = "rust-latest";

/// Номер збірки (коміт) цього застосунку; для локальної збірки — `dev`, вона оновлень не пропонує.
pub fn build_id() -> &'static str {
    option_env!("TRANSLY_BUILD_ID").filter(|s| !s.is_empty()).unwrap_or("dev")
}

pub fn built_at() -> &'static str {
    option_env!("TRANSLY_BUILT_AT").unwrap_or("")
}

pub struct Latest {
    pub release: ReleaseInfo,
    pub asset: Option<(String, String, u64)>,
    pub newer: bool,
}

/// Файл нативної збірки в релізі: `.exe` (перевага назві з `native`).
fn pick_native(release: &ReleaseInfo) -> Option<(String, String, u64)> {
    let by = |f: &dyn Fn(&str) -> bool| release.assets.iter().find(|a| f(&a.name.to_lowercase()));
    by(&|n| n.ends_with(".exe") && n.contains("native")).or_else(|| by(&|n| n.ends_with(".exe"))).map(|a| (a.name.clone(), a.url.clone(), a.size as u64))
}

/// Репозиторій зі збірками: CI вшиває своє (`TRANSLY_UPDATE_REPO`), інакше — основний. Репозиторій публічний, тож токен для оновлень не потрібен.
pub fn update_repo() -> &'static str {
    option_env!("TRANSLY_UPDATE_REPO").filter(|s| !s.is_empty()).unwrap_or("jazirka/transly")
}

/// Питає GitHub про реліз `rust-latest`. Токен потрібен лише для приватного репозиторію (порожній — без нього; застосунок його більше не передає).
pub fn check_latest(repo: &str, token: &str) -> Result<Latest, String> {
    let repo = repo.trim();
    let ok = repo.split('/').count() == 2 && repo.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_'));
    if !ok {
        return Err("Репозиторій вкажіть як «власник/назва»".into());
    }
    let agent = ureq::AgentBuilder::new().user_agent("transly").timeout(std::time::Duration::from_secs(30)).build();
    let mut req = agent.get(&format!("https://api.github.com/repos/{repo}/releases/tags/{NATIVE_TAG}")).set("Accept", "application/vnd.github+json").set("X-GitHub-Api-Version", "2022-11-28");
    if !token.trim().is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", token.trim()));
    }
    let json: serde_json::Value = match req.call() {
        Ok(r) => r.into_json().map_err(|_| "GitHub надіслав незрозумілу відповідь".to_string())?,
        Err(ureq::Error::Status(401 | 403, _)) => return Err("GitHub не віддав реліз (забагато запитів або репозиторій закритий): спробуйте за кілька хвилин".into()),
        Err(ureq::Error::Status(404, _)) => return Err("Релізу нативної збірки ще немає".into()),
        Err(ureq::Error::Status(c, _)) => return Err(format!("GitHub: помилка {c}")),
        Err(_) => return Err("Немає з’єднання з GitHub".into()),
    };
    let release = parse_release(&json).ok_or("GitHub надіслав незрозумілу відповідь")?;
    let newer = update_available(build_id(), &release.sha, &release.published, built_at());
    Ok(Latest { asset: pick_native(&release), release, newer })
}

/// Завантажує новий `.exe` у `dir` і перевіряє його за розміром і контрольною сумою GitHub. Блокувальна: викликати з потоку.
pub fn download_new(asset: &(String, String, u64), token: &str, dir: &Path) -> Result<PathBuf, String> {
    allowed_update(&asset.1, &asset.0)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dest = dir.join("Transly-native.new.exe");
    download_asset(&asset.1, token.trim(), &dest)?;
    Ok(dest)
}

/// Що робить помічник після закриття застосунку: чекає на нього, підміняє `.exe` новим, за потреби запускає знову, прибирає.
pub fn replace_script(pid: u32, new_exe: &Path, exe: &Path, relaunch: bool) -> String {
    let again = if relaunch { format!("; Start-Process -FilePath {}", ps_quote(&exe.to_string_lossy())) } else { String::new() };
    format!(
        "Wait-Process -Id {pid} -ErrorAction SilentlyContinue; $ok = $false; for ($i = 0; $i -lt 40 -and -not $ok; $i++) {{ try {{ Copy-Item -LiteralPath {new} -Destination {old} -Force -ErrorAction Stop; $ok = $true }} catch {{ Start-Sleep -Milliseconds 500 }} }}; if ($ok) {{ Remove-Item -LiteralPath {new} -Force -ErrorAction SilentlyContinue }}{again}",
        new = ps_quote(&new_exe.to_string_lossy()),
        old = ps_quote(&exe.to_string_lossy()),
    )
}

#[cfg(windows)]
pub fn spawn_replace(new_exe: &Path, relaunch: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = replace_script(std::process::id(), new_exe, &exe, relaunch);
    std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .creation_flags(0x0800_0000 | 0x0000_0200)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Не вдалося запустити заміну файлу: {e}"))
}

#[cfg(not(windows))]
pub fn spawn_replace(_new_exe: &Path, _relaunch: bool) -> Result<(), String> {
    Err("Автоматичне оновлення працює лише у Windows: завантажте файл зі сторінки релізу".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use transly_core::update::ReleaseAsset;

    #[test]
    fn the_native_exe_is_picked_and_dev_builds_never_ask() {
        let rel = ReleaseInfo {
            sha: "abc1234".into(),
            published: "2026-11-25T10:00:00Z".into(),
            assets: vec![ReleaseAsset { name: "notes.txt".into(), url: "u1".into(), size: 1.0, digest: None }, ReleaseAsset { name: "Transly-native.exe".into(), url: "u2".into(), size: 2048.0, digest: None }],
        };
        assert_eq!(pick_native(&rel).unwrap().0, "Transly-native.exe");
        // тестова збірка — `dev`: нова версія не пропонується
        assert_eq!(build_id(), "dev");
        assert!(!update_available(build_id(), &rel.sha, &rel.published, built_at()));
        assert!(update_available("0000000", &rel.sha, &rel.published, "2026-11-01T00:00:00Z"));
        assert!(!update_available("abc1234ffff", &rel.sha, &rel.published, ""), "та сама збірка");
    }

    #[test]
    fn the_helper_waits_swaps_the_file_and_starts_the_app_again() {
        let s = replace_script(42, Path::new("C:\\u\\new.exe"), Path::new("C:\\a\\it's.exe"), true);
        assert!(s.starts_with("Wait-Process -Id 42"));
        assert!(s.contains("Copy-Item -LiteralPath 'C:\\u\\new.exe' -Destination 'C:\\a\\it''s.exe' -Force"), "{s}");
        assert!(s.ends_with("Start-Process -FilePath 'C:\\a\\it''s.exe'"));
        assert!(!replace_script(1, Path::new("n"), Path::new("o"), false).contains("Start-Process"));
    }

    #[test]
    fn a_bad_repository_is_refused_before_any_request() {
        assert!(check_latest("no-slash", "").is_err());
        assert!(check_latest("a/b/c", "").is_err());
        assert!(check_latest("a b/c", "").is_err());
    }
}
