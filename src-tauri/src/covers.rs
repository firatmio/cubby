//! Dünya kapakları: oyun içi ekran görüntülerinden (F2) arka plan görseli.
//! O sunucu açıkken çekilen görüntüler dünyaya eşlenir; kullanıcı elle de seçebilir.

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::instance::{self, Cover, CoverKind, Instance};
use crate::paths;
use crate::sessions::{self, META_DIR, Session};
use crate::settings::SettingsStore;

pub const COVER_FILE: &str = "cover.jpg";
pub const THUMB_FILE: &str = "thumb.jpg";
const COVER_MAX: u32 = 1920;
const THUMB_MAX: u32 = 480;
const JPEG_QUALITY: u8 = 85;
/// Oturum bittikten sonra çekilen görüntüler de sayılsın (oyundan çıkarken F2).
const SESSION_GRACE_MS: u64 = 2 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub file: String,
    pub taken_at: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ShotList {
    /// Bu dünyanın oturumları sırasında çekilenler.
    pub matched: Vec<Shot>,
    pub others: Vec<Shot>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CoverSource {
    /// Minecraft'ın screenshots klasöründen bir dosya adı.
    Screenshot { file: String },
    /// Bilgisayardan seçilen herhangi bir resim.
    File { path: PathBuf },
    /// Bu dünyanın en yeni ekran görüntüsü (yoksa kapak kaldırılır).
    Auto,
}

/// Yalnız `2026-08-21_15.12.34.png` gibi düz dosya adları (dizin gezinme yok).
pub fn is_valid_shot_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name.to_ascii_lowercase().ends_with(".png")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.() ".contains(c))
}

fn modified_ms(path: &Path) -> Option<u64> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(t.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// Klasördeki ekran görüntüleri, en yeniden eskiye. Çekilme zamanı = dosyanın yazıldığı an.
pub fn scan_shots(dir: &Path) -> Vec<Shot> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut shots: Vec<Shot> = entries
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().into_owned();
            if !is_valid_shot_name(&file) {
                return None;
            }
            Some(Shot {
                taken_at: modified_ms(&e.path())?,
                file,
            })
        })
        .collect();
    shots.sort_by_key(|s| std::cmp::Reverse(s.taken_at));
    shots
}

pub fn in_session(t: u64, s: &Session) -> bool {
    t >= s.start && t <= s.end + SESSION_GRACE_MS
}

pub fn split_shots(shots: Vec<Shot>, sessions: &[Session]) -> ShotList {
    let (matched, others) = shots
        .into_iter()
        .partition(|shot| sessions.iter().any(|s| in_session(shot.taken_at, s)));
    ShotList { matched, others }
}

fn resize(img: &DynamicImage, max: u32) -> DynamicImage {
    let (w, h) = img.dimensions();
    if w <= max && h <= max {
        img.clone()
    } else {
        img.resize(max, max, FilterType::Triangle)
    }
}

fn write_jpeg(img: &DynamicImage, dest: &Path) -> AppResult<()> {
    let tmp = dest.with_extension("jpg.tmp");
    {
        let mut out = BufWriter::new(File::create(&tmp)?);
        JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
            .encode_image(&DynamicImage::ImageRgb8(img.to_rgb8()))
            .map_err(|e| {
                AppError::msg(tx!(
                    "Görsel kaydedilemedi: {e}",
                    "Couldn't save the image: {e}"
                ))
            })?;
    }
    std::fs::rename(tmp, dest)?;
    Ok(())
}

/// Doygun piksellerin ağırlıklı ortalaması (gökyüzü/sis grisi rengi boğmasın),
/// arayüzde vurgu olarak kullanılabilsin diye aydınlatılır.
fn accent_color(img: &DynamicImage) -> String {
    let small = img.resize_exact(24, 24, FilterType::Triangle).to_rgb8();
    let (sum, total) = small
        .pixels()
        .fold(([0u64; 3], 0u64), |(mut acc, total), p| {
            let (hi, lo) = (p.0.iter().max().unwrap(), p.0.iter().min().unwrap());
            let w = ((hi - lo) as u64).pow(2) + 1;
            for i in 0..3 {
                acc[i] += p[i] as u64 * w;
            }
            (acc, total + w)
        });
    let avg = sum.map(|c| (c / total) as u32);
    let max = *avg.iter().max().unwrap_or(&1).max(&1);
    // En parlak kanal ~200 olacak şekilde ölçekle (çok koyu/soluk görsellerde de görünsün).
    let scale = 200.0 / max as f32;
    let c = avg.map(|v| ((v as f32 * scale).min(255.0)) as u8);
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// Kaynaktan `cover.jpg` + `thumb.jpg` üretir; baskın rengi döner. Yavaş: blocking bağlamda çağır.
pub fn render_cover(src: &Path, meta_dir: &Path) -> AppResult<String> {
    let img = image::open(src)
        .map_err(|e| AppError::msg(tx!("Resim açılamadı: {e}", "Couldn't open the image: {e}")))?;
    std::fs::create_dir_all(meta_dir)?;
    write_jpeg(&resize(&img, COVER_MAX), &meta_dir.join(COVER_FILE))?;
    let thumb = resize(&img, THUMB_MAX);
    write_jpeg(&thumb, &meta_dir.join(THUMB_FILE))?;
    Ok(accent_color(&thumb))
}

pub const SERVER_ICON: &str = "server-icon.png";

/// Sunucu listesinde görünen 64×64 simge: kapağın ortasından kare kırpılır.
/// Minecraft simgeyi sunucu açılırken okur.
pub fn write_server_icon(cover: &Path, server_dir: &Path) -> AppResult<()> {
    let img = image::open(cover)
        .map_err(|e| AppError::msg(tx!("Resim açılamadı: {e}", "Couldn't open the image: {e}")))?;
    let (w, h) = img.dimensions();
    let side = w.min(h);
    let icon = img
        .crop_imm((w - side) / 2, (h - side) / 2, side, side)
        .resize_exact(64, 64, FilterType::Lanczos3);
    std::fs::create_dir_all(server_dir)?;
    let tmp = server_dir.join("server-icon.png.tmp");
    icon.to_rgb8()
        .save_with_format(&tmp, image::ImageFormat::Png)
        .map_err(|e| AppError::msg(format!("Simge kaydedilemedi: {e}")))?;
    std::fs::rename(tmp, server_dir.join(SERVER_ICON))?;
    Ok(())
}

/// Tüm ekran görüntüsü klasörleri birlikte, en yeni önce.
fn all_shots(app: &AppHandle) -> Vec<Shot> {
    let mut shots: Vec<Shot> = app
        .state::<SettingsStore>()
        .screenshot_dirs()
        .iter()
        .flat_map(|d| scan_shots(d))
        .collect();
    shots.sort_by_key(|s| std::cmp::Reverse(s.taken_at));
    shots
}

fn shot_path(app: &AppHandle, file: &str) -> AppResult<PathBuf> {
    app.state::<SettingsStore>()
        .find_shot(file)
        .ok_or_else(|| AppError::msg(tx!("Ekran görüntüsü bulunamadı", "Screenshot not found")))
}

pub fn list_for(app: &AppHandle, id: &str) -> AppResult<ShotList> {
    let dir = paths::instance_dir(app, id)?;
    Ok(split_shots(all_shots(app), &sessions::load(&dir)))
}

async fn apply(
    app: &AppHandle,
    id: &str,
    src: Option<PathBuf>,
    kind: CoverKind,
) -> AppResult<Instance> {
    let dir = paths::instance_dir(app, id)?;
    let meta = dir.join(META_DIR);
    let color = match src {
        Some(src) => {
            let meta = meta.clone();
            let server_dir = dir.join("server");
            let color = tauri::async_runtime::spawn_blocking(move || {
                let color = render_cover(&src, &meta)?;
                // Simge hatası kapağı bozmasın.
                if let Err(e) = write_server_icon(&meta.join(COVER_FILE), &server_dir) {
                    eprintln!("Sunucu simgesi yazılamadı: {e}");
                }
                Ok::<_, AppError>(color)
            })
            .await
            .map_err(|e| AppError::msg(e.to_string()))??;
            Some(color)
        }
        None => {
            let _ = std::fs::remove_file(meta.join(COVER_FILE));
            let _ = std::fs::remove_file(meta.join(THUMB_FILE));
            let _ = std::fs::remove_file(dir.join("server").join(SERVER_ICON));
            None
        }
    };
    instance::modify(&dir, |inst| {
        let version = inst.cover.as_ref().map_or(0, |c| c.version) + 1;
        inst.cover = color.map(|color| Cover {
            kind,
            color,
            version,
        });
        Ok(())
    })
}

pub async fn set_cover(app: &AppHandle, id: &str, source: CoverSource) -> AppResult<Instance> {
    match source {
        CoverSource::Screenshot { file } => {
            if !is_valid_shot_name(&file) {
                return Err(AppError::msg(tx!(
                    "Geçersiz dosya adı",
                    "Invalid file name"
                )));
            }
            let path = shot_path(app, &file)?;
            apply(app, id, Some(path), CoverKind::Manual).await
        }
        CoverSource::File { path } => apply(app, id, Some(path), CoverKind::Manual).await,
        CoverSource::Auto => {
            let newest = list_for(app, id)?.matched.into_iter().next();
            let src = match newest {
                Some(s) => Some(shot_path(app, &s.file)?),
                None => None,
            };
            apply(app, id, src, CoverKind::Auto).await
        }
    }
}

/// Oturum bitince: kapak elle seçilmediyse o oturumun en yeni görüntüsü kapak olur.
pub async fn after_session(app: &AppHandle, id: &str, session: Session) -> AppResult<()> {
    if !app.state::<SettingsStore>().get().use_screenshots {
        return Ok(());
    }
    let inst = instance::get(app, id)?;
    if inst
        .cover
        .as_ref()
        .is_some_and(|c| c.kind == CoverKind::Manual)
    {
        return Ok(());
    }
    let Some(newest) = all_shots(app)
        .into_iter()
        .find(|s| in_session(s.taken_at, &session))
    else {
        return Ok(());
    };
    let path = shot_path(app, &newest.file)?;
    apply(app, id, Some(path), CoverKind::Auto).await?;
    use tauri::Emitter;
    let _ = app.emit(EVENT_COVER_CHANGED, id);
    Ok(())
}

pub const EVENT_COVER_CHANGED: &str = "cover://changed";

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mcsm-cover-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn validates_shot_names() {
        assert!(is_valid_shot_name("2026-08-21_15.12.34.png"));
        assert!(is_valid_shot_name("2026-08-21_15.12.34_1.PNG"));
        assert!(!is_valid_shot_name("../secret.png"));
        assert!(!is_valid_shot_name("a\\b.png"));
        assert!(!is_valid_shot_name("a/b.png"));
        assert!(!is_valid_shot_name(".hidden.png"));
        assert!(!is_valid_shot_name("foto.jpg"));
    }

    #[test]
    fn splits_by_session() {
        let shots = vec![
            Shot {
                file: "c.png".into(),
                taken_at: 500_000,
            },
            Shot {
                file: "b.png".into(),
                taken_at: 200_000,
            },
            Shot {
                file: "a.png".into(),
                taken_at: 10,
            },
        ];
        let sessions = [Session {
            start: 100_000,
            end: 150_000,
        }];
        let list = split_shots(shots, &sessions);
        // b oturum içinde değil ama 2 dk tolerans içinde: 150_000 + 120_000 >= 200_000
        assert_eq!(
            list.matched
                .iter()
                .map(|s| s.file.as_str())
                .collect::<Vec<_>>(),
            ["b.png"]
        );
        assert_eq!(list.others.len(), 2);
    }

    #[test]
    fn renders_cover_thumb_and_color() {
        let dir = temp();
        let src = dir.join("shot.png");
        // 2400x1200 yeşilimsi sentetik görsel
        let img = image::RgbImage::from_fn(2400, 1200, |x, _| {
            image::Rgb([40, 120 + (x % 50) as u8, 40])
        });
        img.save(&src).unwrap();
        let meta = dir.join(META_DIR);
        let color = render_cover(&src, &meta).unwrap();
        let cover = image::open(meta.join(COVER_FILE)).unwrap();
        let thumb = image::open(meta.join(THUMB_FILE)).unwrap();
        assert_eq!(cover.dimensions(), (1920, 960));
        assert_eq!(thumb.dimensions(), (480, 240));
        assert!(color.starts_with('#') && color.len() == 7);
        let g = u8::from_str_radix(&color[3..5], 16).unwrap();
        let r = u8::from_str_radix(&color[1..3], 16).unwrap();
        assert!(g > r, "yeşil baskın olmalı: {color}");

        let server = dir.join("server");
        write_server_icon(&meta.join(COVER_FILE), &server).unwrap();
        assert_eq!(
            image::open(server.join(SERVER_ICON)).unwrap().dimensions(),
            (64, 64)
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Bu makinedeki en yeni gerçek ekran görüntüsünden kapak üretir (yalnız okur):
    /// `cargo test -- --ignored live_cover --nocapture`
    #[test]
    #[ignore = "makineye bağlı"]
    fn live_cover() {
        let shots_dir = crate::settings::default_minecraft_dir()
            .unwrap()
            .join("screenshots");
        let newest = scan_shots(&shots_dir)
            .into_iter()
            .next()
            .expect("ekran görüntüsü yok");
        let out = crate::util::live_test_dir("cover");
        let t = std::time::Instant::now();
        let color = render_cover(&shots_dir.join(&newest.file), &out).unwrap();
        println!(
            "{} -> {} renk {color} ({:?})",
            newest.file,
            out.display(),
            t.elapsed()
        );
    }
}
