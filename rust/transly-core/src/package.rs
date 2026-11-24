//! `ext/package.ts`: перевірка файлів пакета плагіна за його описом. Опис правильний, кожен файл названо в ньому з вірною
//! контрольною сумою, зайвих файлів немає, кожен файл — текст розумного розміру. Пакет, що пройшов, — це те, що опублікував автор;
//! той, що не пройшов, відхиляється цілком.

use crate::manifest::{check_manifest, Checked, Limits, MANIFEST_FILE};
use indexmap::IndexMap;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Пакет після читання й перевірки: опис і файли як текст.
#[derive(Clone, Debug, PartialEq)]
pub struct PluginPackage {
    pub manifest: Value,
    /// Опис саме так, як його написано (його хеш ідентифікує пакет).
    pub manifest_text: String,
    /// Текст кожного файла пакета, крім опису, за шляхом.
    pub files: IndexMap<String, String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Built {
    Ok(Box<PluginPackage>),
    Err(Vec<String>),
}

/// SHA-256 байтів малими літерами hex.
pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// `TextDecoder('utf-8', { fatal: true })`: помилка на хибних байтах, провідний BOM знімається.
fn decode(bytes: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(bytes).ok()?;
    Some(s.strip_prefix('\u{feff}').unwrap_or(s).to_string())
}

pub fn build_package(entries: &IndexMap<String, Vec<u8>>, builtin: bool) -> Built {
    let Some(raw) = entries.get(MANIFEST_FILE) else { return Built::Err(vec![format!("У пакеті немає файлу «{MANIFEST_FILE}»")]) };
    if raw.len() > Limits::MANIFEST_BYTES {
        return Built::Err(vec!["Опис розширення завеликий".into()]);
    }
    let Some(manifest_text) = decode(raw) else { return Built::Err(vec!["Опис розширення не в кодуванні UTF-8".into()]) };
    let (m, warnings) = match check_manifest(&Value::String(manifest_text.clone()), builtin) {
        Checked::Ok { manifest, warnings } => (manifest, warnings),
        Checked::Err { errors } => return Built::Err(errors),
    };
    let empty = serde_json::Map::new();
    let listed = m.get("files").and_then(Value::as_object).unwrap_or(&empty);
    let mut errors: Vec<String> = Vec::new();
    let mut files: IndexMap<String, String> = IndexMap::new();
    let names: Vec<&String> = entries.keys().filter(|p| p.as_str() != MANIFEST_FILE).collect();
    if names.len() > Limits::FILES {
        errors.push("Забагато файлів у пакеті".into());
    }
    for p in &names {
        if !listed.contains_key(p.as_str()) {
            errors.push(format!("Файл «{p}» є в пакеті, але його немає в описі (files)"));
        }
    }
    let mut total = 0usize;
    for (p, want) in listed {
        let Some(bytes) = entries.get(p) else {
            errors.push(format!("Файл «{p}» названо в описі, але його немає в пакеті"));
            continue;
        };
        total += bytes.len();
        if bytes.len() > Limits::FILE_BYTES {
            errors.push(format!("Файл «{p}» завеликий"));
            continue;
        }
        if want.as_str() != Some(&format!("sha256-{}", sha256_hex(bytes))) {
            errors.push(format!("Файл «{p}» не збігається з контрольною сумою в описі"));
            continue;
        }
        match decode(bytes) {
            Some(text) if !text.contains('\0') => {
                files.insert(p.clone(), text);
            }
            _ => errors.push(format!("Файл «{p}» має бути текстом UTF-8")),
        }
    }
    if total > Limits::TOTAL_BYTES {
        errors.push("Пакет завеликий".into());
    }
    if errors.is_empty() {
        Built::Ok(Box::new(PluginPackage { manifest: m, manifest_text, files, warnings }))
    } else {
        Built::Err(errors)
    }
}

/// Те саме для файлів, уже прочитаних як текст (тека або файли з мережі).
pub fn build_package_from_text(manifest_text: &str, files: &IndexMap<String, String>, builtin: bool) -> Built {
    let mut map: IndexMap<String, Vec<u8>> = IndexMap::new();
    map.insert(MANIFEST_FILE.to_string(), manifest_text.as_bytes().to_vec());
    for (p, t) in files {
        map.insert(p.clone(), t.as_bytes().to_vec());
    }
    build_package(&map, builtin)
}
