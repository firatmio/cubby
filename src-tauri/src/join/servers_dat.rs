//! Minecraft'ın Çok Oyunculu listesi: `.minecraft/servers.dat` (sıkıştırılmamış NBT).
//! Bilinmeyen alanlar (`icon`, `acceptTextures`…) olduğu gibi korunur.

use std::collections::HashMap;
use std::path::Path;

use fastnbt::Value;

use crate::error::{AppError, AppResult};

pub const FILE: &str = "servers.dat";

fn empty() -> Value {
    Value::Compound(HashMap::from([(
        "servers".to_string(),
        Value::List(Vec::new()),
    )]))
}

/// Dosya yoksa boş liste döner.
pub fn read(mc_dir: &Path) -> AppResult<Value> {
    match std::fs::read(mc_dir.join(FILE)) {
        Ok(bytes) => fastnbt::from_bytes(&bytes)
            .map_err(|e| AppError::msg(format!("servers.dat okunamadı: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(empty()),
        Err(e) => Err(e.into()),
    }
}

/// Önce `servers.dat_old` yedeği (Minecraft'ın kendi yedek adı), sonra atomik yazım.
pub fn write(mc_dir: &Path, root: &Value) -> AppResult<()> {
    let path = mc_dir.join(FILE);
    if path.exists() {
        std::fs::copy(&path, mc_dir.join("servers.dat_old"))?;
    }
    let bytes = fastnbt::to_bytes(root)
        .map_err(|e| AppError::msg(format!("servers.dat yazılamadı: {e}")))?;
    let tmp = mc_dir.join("servers.dat.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(tmp, path)?;
    Ok(())
}

fn servers(root: &mut Value) -> &mut Vec<Value> {
    if !matches!(root, Value::Compound(_)) {
        *root = empty();
    }
    let Value::Compound(map) = root else {
        unreachable!()
    };
    let list = map
        .entry("servers".to_string())
        .or_insert_with(|| Value::List(Vec::new()));
    if !matches!(list, Value::List(_)) {
        *list = Value::List(Vec::new());
    }
    let Value::List(list) = list else {
        unreachable!()
    };
    list
}

fn ip_of(entry: &Value) -> Option<&str> {
    match entry {
        Value::Compound(m) => match m.get("ip") {
            Some(Value::String(s)) => Some(s),
            _ => None,
        },
        _ => None,
    }
}

pub fn contains(root: &mut Value, ip: &str) -> bool {
    servers(root).iter().any(|e| ip_of(e) == Some(ip))
}

/// Aynı adres varsa adını günceller, yoksa listenin en başına ekler.
pub fn upsert(root: &mut Value, ip: &str, name: &str) {
    let list = servers(root);
    if let Some(Value::Compound(m)) = list.iter_mut().find(|e| ip_of(e) == Some(ip)) {
        m.insert("name".into(), Value::String(name.into()));
        return;
    }
    list.insert(
        0,
        Value::Compound(HashMap::from([
            ("ip".to_string(), Value::String(ip.into())),
            ("name".to_string(), Value::String(name.into())),
        ])),
    );
}

pub fn remove(root: &mut Value, ip: &str) -> bool {
    let list = servers(root);
    let before = list.len();
    list.retain(|e| ip_of(e) != Some(ip));
    list.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(root: &mut Value) -> Vec<(String, String)> {
        servers(root)
            .iter()
            .map(|e| {
                let Value::Compound(m) = e else { panic!() };
                let s = |k: &str| match m.get(k) {
                    Some(Value::String(s)) => s.clone(),
                    _ => String::new(),
                };
                (s("ip"), s("name"))
            })
            .collect()
    }

    #[test]
    fn upsert_inserts_first_and_updates_in_place() {
        let mut root = empty();
        upsert(&mut root, "play.example.com", "Eski");
        upsert(&mut root, "127.0.0.1:25601", "Ali'nin dünyası");
        assert_eq!(
            names(&mut root),
            vec![
                ("127.0.0.1:25601".into(), "Ali'nin dünyası".into()),
                ("play.example.com".into(), "Eski".into())
            ]
        );
        upsert(&mut root, "127.0.0.1:25601", "Yeni ad");
        assert_eq!(names(&mut root)[0].1, "Yeni ad");
        assert_eq!(names(&mut root).len(), 2);
        assert!(contains(&mut root, "127.0.0.1:25601"));
        assert!(remove(&mut root, "127.0.0.1:25601"));
        assert!(!contains(&mut root, "127.0.0.1:25601"));
    }

    #[test]
    fn file_roundtrip_keeps_unknown_fields_and_backs_up() {
        let dir = std::env::temp_dir().join(format!("mcsm-serversdat-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        // Minecraft'ın yazdığı gibi: icon ve acceptTextures alanlı bir kayıt.
        let original = Value::Compound(HashMap::from([(
            "servers".to_string(),
            Value::List(vec![Value::Compound(HashMap::from([
                ("ip".to_string(), Value::String("mc.example.org".into())),
                ("name".to_string(), Value::String("Örnek".into())),
                ("icon".to_string(), Value::String("iVBORw0KGgo=".into())),
                ("acceptTextures".to_string(), Value::Byte(1)),
            ]))]),
        )]));
        write(&dir, &original).unwrap();

        let mut root = read(&dir).unwrap();
        upsert(&mut root, "127.0.0.1:25600", "Arkadaş");
        write(&dir, &root).unwrap();

        let mut back = read(&dir).unwrap();
        assert_eq!(names(&mut back).len(), 2);
        let Value::Compound(m) = &servers(&mut back)[1] else {
            panic!()
        };
        assert_eq!(m.get("acceptTextures"), Some(&Value::Byte(1)));
        assert!(m.contains_key("icon"));
        assert!(dir.join("servers.dat_old").exists());
        assert_eq!(names(&mut read(&dir.join("yok")).unwrap()).len(), 0);
    }
}
