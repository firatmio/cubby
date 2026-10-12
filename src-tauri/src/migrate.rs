//! Uygulama adı değişti (MC Sunucu Yöneticisi → Cubby): veri klasörü yeni kimliğe taşınır ve
//! kayıtlardaki eski klasör yolları düzeltilir. İlk açılışta bir kez çalışır.

use std::path::{Path, PathBuf};

use serde_json::Value;

/// Eski uygulama kimliği (veri klasörünün adı).
const OLD_IDENTIFIER: &str = "com.firatmio.mc-server-launcher";

/// Eski kökle başlayan her metni yeni köke çevirir.
fn rewrite(v: &mut Value, old: &str, new: &str) -> bool {
    match v {
        Value::String(s) if s.starts_with(old) => {
            *s = format!("{new}{}", &s[old.len()..]);
            true
        }
        // Hepsi dolaşılsın diye `any` değil (kısa devre yapar).
        Value::Array(items) => items
            .iter_mut()
            .map(|x| rewrite(x, old, new))
            .fold(false, |a, b| a | b),
        Value::Object(map) => map
            .values_mut()
            .map(|x| rewrite(x, old, new))
            .fold(false, |a, b| a | b),
        _ => false,
    }
}

fn rewrite_file(file: &Path, old: &str, new: &str) {
    let Ok(bytes) = std::fs::read(file) else {
        return;
    };
    let Ok(mut v) = serde_json::from_slice::<Value>(&bytes) else {
        return;
    };
    if rewrite(&mut v, old, new)
        && let Ok(out) = serde_json::to_vec_pretty(&v)
    {
        let _ = std::fs::write(file, out);
    }
}

/// `data` yeni veri klasörü. Yoksa ve eskisi varsa taşır; kayıtlı dünyaların `instance.json`'ları,
/// `instances.json`, `settings.json` ve `joined.json` içindeki yollar yeni köke çevrilir.
pub fn app_data(data: &Path) {
    let Some(old) = data.parent().map(|p| p.join(OLD_IDENTIFIER)) else {
        return;
    };
    if data.exists() || !old.is_dir() {
        return;
    }
    if let Err(e) = std::fs::rename(&old, data) {
        eprintln!("Eski veri klasörü taşınamadı: {e}");
        return;
    }
    let (old_s, new_s) = (old.display().to_string(), data.display().to_string());
    for name in ["instances.json", "settings.json", "joined.json"] {
        rewrite_file(&data.join(name), &old_s, &new_s);
    }
    // Dünyaların kendi kayıtları (ör. uygulamanın indirdiği Java'nın yolu).
    let registry: Vec<PathBuf> = std::fs::read(data.join("instances.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok())
        .unwrap_or_default()
        .iter()
        .filter_map(|e| e.get("path")?.as_str().map(PathBuf::from))
        .collect();
    for dir in registry {
        rewrite_file(&dir.join("instance.json"), &old_s, &new_s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn moves_folder_and_fixes_paths() {
        let root = std::env::temp_dir().join(format!("mcsm-migrate-{}", uuid::Uuid::new_v4()));
        let old = root.join(OLD_IDENTIFIER);
        let new = root.join("com.quacomes.cubby");
        let inst = old.join("instances").join("a");
        std::fs::create_dir_all(&inst).unwrap();
        let p = |d: &Path| d.display().to_string();
        std::fs::write(
            old.join("instances.json"),
            json!([{"id": "a", "path": p(&inst)}]).to_string(),
        )
        .unwrap();
        std::fs::write(
            inst.join("instance.json"),
            json!({"id": "a", "javaPath": p(&old.join("java/jdk/bin/java.exe")), "name": "x"})
                .to_string(),
        )
        .unwrap();

        app_data(&new);
        assert!(!old.exists());
        let reg: Value =
            serde_json::from_slice(&std::fs::read(new.join("instances.json")).unwrap()).unwrap();
        assert_eq!(reg[0]["path"], json!(p(&new.join("instances").join("a"))));
        let i: Value =
            serde_json::from_slice(&std::fs::read(new.join("instances/a/instance.json")).unwrap())
                .unwrap();
        assert_eq!(i["javaPath"], json!(p(&new.join("java/jdk/bin/java.exe"))));
        assert_eq!(i["name"], json!("x"));

        // İkinci çalıştırmada hiçbir şey yapmaz.
        app_data(&new);
        assert!(new.join("instances.json").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }
}
