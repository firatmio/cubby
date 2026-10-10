//! `media://` protokolü: arayüze yalnızca kapak ve ekran görüntüsü önizlemelerini servis eder.
//! Yollar: `/cover/<id>`, `/thumb/<id>`, `/shot/<dosya>`. Başka hiçbir dosyaya erişilemez.

use std::path::{Path, PathBuf};

use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::covers::{self, COVER_FILE, THUMB_FILE};
use crate::paths;
use crate::sessions::META_DIR;
use crate::settings::SettingsStore;

pub const SCHEME: &str = "media";

#[derive(Debug, PartialEq, Eq)]
enum Target {
    Cover(String),
    Thumb(String),
    Shot(String),
}

fn parse(path: &str) -> Option<Target> {
    let (kind, arg) = path.trim_start_matches('/').split_once('/')?;

    if arg.contains('/') || arg.contains('\\') || arg.contains('%') {
        return None;
    }
    match kind {
        "cover" if paths::validate_id(arg).is_ok() => Some(Target::Cover(arg.into())),
        "thumb" if paths::validate_id(arg).is_ok() => Some(Target::Thumb(arg.into())),
        "shot" if covers::is_valid_shot_name(arg) => Some(Target::Shot(arg.into())),
        _ => None,
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .unwrap()
}

fn jpeg(bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .header("Content-Type", "image/jpeg")
        // URL'ler sürüm parametresi taşıdığı için uzun süre önbelleklenebilir.
        .header("Cache-Control", "max-age=31536000, immutable")
        .body(bytes)
        .unwrap()
}

/// Ekran görüntüsü önizlemesi: ilk istekte küçültülüp `app_data/cache/shots`'a yazılır.
fn shot_preview(app: &AppHandle, file: &str) -> Option<PathBuf> {
    let src = app.state::<SettingsStore>().find_shot(file)?;
    let cache = app.path().app_data_dir().ok()?.join("cache").join("shots");
    let out = cache.join(format!("{file}.jpg"));
    let fresh = |p: &Path| {
        let (a, b) = (std::fs::metadata(p).ok()?, std::fs::metadata(&src).ok()?);
        Some(a.modified().ok()? >= b.modified().ok()?)
    };
    if fresh(&out) != Some(true) {
        let tmp = cache.join(format!("{file}.tmpdir"));
        covers::render_cover(&src, &tmp).ok()?;
        std::fs::create_dir_all(&cache).ok()?;
        std::fs::rename(tmp.join(THUMB_FILE), &out).ok()?;
        let _ = std::fs::remove_dir_all(&tmp);
    }
    Some(out)
}

/// Blocking: dosya okuma ve gerekirse küçültme.
pub fn respond(app: &AppHandle, path: &str) -> Response<Vec<u8>> {
    let file = match parse(path) {
        Some(Target::Cover(id)) => paths::instance_dir(app, &id)
            .ok()
            .map(|d| d.join(META_DIR).join(COVER_FILE)),
        Some(Target::Thumb(id)) => paths::instance_dir(app, &id)
            .ok()
            .map(|d| d.join(META_DIR).join(THUMB_FILE)),
        Some(Target::Shot(name)) => shot_preview(app, &name),
        None => None,
    };
    match file.and_then(|f| std::fs::read(f).ok()) {
        Some(bytes) => jpeg(bytes),
        None => not_found(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_known_targets() {
        assert_eq!(
            parse("/cover/abc-123"),
            Some(Target::Cover("abc-123".into()))
        );
        assert_eq!(parse("/thumb/abc"), Some(Target::Thumb("abc".into())));
        assert_eq!(
            parse("/shot/2026-08-21_15.12.34.png"),
            Some(Target::Shot("2026-08-21_15.12.34.png".into()))
        );
        assert_eq!(parse("/cover/../x"), None);
        assert_eq!(parse("/shot/..%2Fsecret.png"), None);
        assert_eq!(parse("/shot/a/b.png"), None);
        assert_eq!(parse("/etc/passwd"), None);
        assert_eq!(parse("/cover/"), None);
    }
}
