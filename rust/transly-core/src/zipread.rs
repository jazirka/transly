//! `ext/zipread.ts`: читання zip-архівів пакетів плагінів (збережені й стиснуті записи, без шифрування й zip64). Архів — недовірені дані:
//! кожен розмір перевіряється до й під час розпакування («zip-бомба»), кожне імʼя й кожна контрольна сума. Результат — лише імена й байти.

use crate::manifest::Limits;
use indexmap::IndexMap;
use regex::Regex;
use std::io::Read;
use std::sync::LazyLock;

static SKIP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(^|/)(__MACOSX/|\.DS_Store$|Thumbs\.db$)").unwrap());

fn u16(b: &[u8], o: usize) -> usize {
    u16::from_le_bytes([b[o], b[o + 1]]) as usize
}
fn u32(b: &[u8], o: usize) -> usize {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) as usize
}

fn inflate(data: &[u8], expected: usize) -> Result<Vec<u8>, String> {
    let cap = expected.min(Limits::FILE_BYTES);
    let mut out = Vec::new();
    let mut dec = flate2::read::DeflateDecoder::new(data).take(cap as u64 + 1);
    dec.read_to_end(&mut out).map_err(|_| "Архів пошкоджено".to_string())?;
    if out.len() > cap {
        return Err("Файл у архіві розпаковується більше, ніж заявлено".into());
    }
    Ok(out)
}

/// Файли zip за шляхом (теки опущено, спільну верхню теку архіву GitHub знято).
pub fn read_zip(bytes: &[u8]) -> Result<IndexMap<String, Vec<u8>>, String> {
    if bytes.len() > Limits::TOTAL_BYTES * 2 {
        return Err("Архів завеликий".into());
    }
    let len = bytes.len();
    let mut eocd: Option<usize> = None;
    if len >= 22 {
        let low = (len - 22).saturating_sub(65535);
        let mut i = len - 22;
        loop {
            if u32(bytes, i) == 0x06054b50 {
                eocd = Some(i);
                break;
            }
            if i == low {
                break;
            }
            i -= 1;
        }
    }
    let Some(eocd) = eocd else { return Err("Це не zip-архів".into()) };
    let (count, cd_size, cd_at) = (u16(bytes, eocd + 10), u32(bytes, eocd + 12), u32(bytes, eocd + 16));
    if count == 0xffff || cd_at == 0xffff_ffff {
        return Err("Архіви zip64 не підтримуються".into());
    }
    if count > Limits::FILES + 20 || cd_at + cd_size > len {
        return Err("Архів пошкоджено або має забагато файлів".into());
    }
    let mut out: IndexMap<String, Vec<u8>> = IndexMap::new();
    let (mut at, mut total) = (cd_at, 0usize);
    for _ in 0..count {
        if at + 46 > len || u32(bytes, at) != 0x02014b50 {
            return Err("Архів пошкоджено".into());
        }
        let (flags, method, crc, csize, usize_) = (u16(bytes, at + 8), u16(bytes, at + 10), u32(bytes, at + 16), u32(bytes, at + 20), u32(bytes, at + 24));
        let (nl, xl, cl, lh) = (u16(bytes, at + 28), u16(bytes, at + 30), u16(bytes, at + 32), u32(bytes, at + 42));
        let raw_name = &bytes[(at + 46).min(len)..(at + 46 + nl).min(len)];
        let decoded = String::from_utf8_lossy(raw_name);
        let name = decoded.strip_prefix('\u{feff}').unwrap_or(&decoded).to_string();
        at += 46 + nl + xl + cl;
        if name.ends_with('/') || SKIP.is_match(&name) {
            continue;
        }
        if flags & 1 != 0 {
            return Err("Зашифровані архіви не підтримуються".into());
        }
        if name.contains('\\') || name.starts_with('/') || name.split('/').any(|s| s == "..") || name.contains('\0') {
            return Err(format!("Небезпечне ім’я файлу в архіві: «{name}»"));
        }
        if usize_ > Limits::FILE_BYTES {
            return Err(format!("Файл «{name}» завеликий"));
        }
        total += usize_;
        if total > Limits::TOTAL_BYTES {
            return Err("Пакет завеликий".into());
        }
        if lh + 30 > len || u32(bytes, lh) != 0x04034b50 {
            return Err("Архів пошкоджено".into());
        }
        let start = lh + 30 + u16(bytes, lh + 26) + u16(bytes, lh + 28);
        if start + csize > len {
            return Err("Архів пошкоджено".into());
        }
        let raw = &bytes[start..start + csize];
        let data = match method {
            0 => raw.to_vec(),
            8 => inflate(raw, usize_)?,
            _ => return Err(format!("Спосіб стиснення файлу «{name}» не підтримується")),
        };
        if data.len() != usize_ || crc32fast::hash(&data) as usize != crc {
            return Err(format!("Файл «{name}» пошкоджено (контрольна сума)"));
        }
        if out.contains_key(&name) {
            return Err(format!("Файл «{name}» двічі в архіві"));
        }
        out.insert(name, data);
    }
    // архів репозиторію має все в одній теці (`repo-1a2b3c/…`): тека не частина пакета
    let top = match out.keys().next() {
        Some(first) if out.keys().all(|p| p.contains('/')) => first.split('/').next().unwrap_or("").to_string(),
        _ => String::new(),
    };
    if !top.is_empty() && out.keys().all(|p| p.starts_with(&format!("{top}/"))) && !out.contains_key("transly-plugin.json") {
        return Ok(out.into_iter().map(|(p, b)| (p[top.len() + 1..].to_string(), b)).collect());
    }
    Ok(out)
}
