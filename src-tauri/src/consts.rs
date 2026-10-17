use std::time::Duration;

/// Davet linklerinin şeması (`cubby://join?d=...`).
pub const URL_SCHEME: &str = "cubby";

/// Davet sayfası ve kısa kod sunucusu (`web/`, Vercel). Kısa kodlar `<JOIN_WEB>/<KOD>` olur.
pub const JOIN_WEB: &str = "https://cubby.quacomes.com";

/// Ad değişmeden önceki şema; eski davet linkleri de açılsın.
pub const LEGACY_URL_SCHEME: &str = "mcsm";

pub const USER_AGENT: &str = concat!("cubby/", env!("CARGO_PKG_VERSION"));

/// `stop` komutundan sonra sürecin kendiliğinden kapanması için beklenen süre; sonra kill.
pub const STOP_TIMEOUT: Duration = Duration::from_secs(30);

/// Rust tarafında sunucu başına tutulan son log satırı sayısı.
pub const LOG_BACKLOG: usize = 1000;

/// CPU/RAM ölçüm aralığı.
pub const STATS_INTERVAL: Duration = Duration::from_secs(2);

/// Mojang sürüm listesinin bellekte tutulma süresi.
pub const MANIFEST_TTL: Duration = Duration::from_secs(10 * 60);

pub const DEFAULT_PORT: u16 = 25565;

/// Microsoft girişi için Azure uygulama kimliği; derlemede `MCSM_MS_CLIENT_ID` ile verilir
/// (bkz. docs/MICROSOFT_GIRIS.md). Yoksa oyun Launcher'la açılır.
pub const MS_CLIENT_ID: Option<&str> = option_env!("MCSM_MS_CLIENT_ID");
