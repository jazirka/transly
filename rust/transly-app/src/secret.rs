//! Токен доступу GitHub: лежить у сховищі облікових даних Windows (Credential Manager), а не у файлі проєкту чи теці даних, тож переживає оновлення програми
//! і не потрапляє в проєкт. У тестах і поза Windows сховища немає: токен живе лише в пам'яті сеансу.

#[cfg(all(windows, not(test)))]
fn entry() -> Option<keyring::Entry> {
    keyring::Entry::new("Transly", "github-token").ok()
}

/// Збережений токен (порожній, коли його немає чи сховище недоступне).
pub fn load_token() -> String {
    #[cfg(all(windows, not(test)))]
    {
        return entry().and_then(|e| e.get_password().ok()).unwrap_or_default();
    }
    #[allow(unreachable_code)]
    String::new()
}

/// Запам'ятати токен; порожній — забути.
pub fn save_token(token: &str) {
    #[cfg(all(windows, not(test)))]
    if let Some(e) = entry() {
        if token.is_empty() {
            let _ = e.delete_credential();
        } else {
            let _ = e.set_password(token);
        }
    }
    #[cfg(not(all(windows, not(test))))]
    let _ = token;
}
