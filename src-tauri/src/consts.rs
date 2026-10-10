use std::time::Duration;

/// Davet linklerinin şeması (`mcsm://join?d=...`). Uygulama adı netleşince yalnızca burası değişir.
#[allow(dead_code)] // M7: deep-link
pub const URL_SCHEME: &str = "mcsm";

pub const USER_AGENT: &str = concat!("mc-server-launcher/", env!("CARGO_PKG_VERSION"));

/// `stop` komutundan sonra sürecin kendiliğinden kapanması için beklenen süre; sonra kill.
pub const STOP_TIMEOUT: Duration = Duration::from_secs(30);

/// Rust tarafında sunucu başına tutulan son log satırı sayısı.
pub const LOG_BACKLOG: usize = 1000;

/// CPU/RAM ölçüm aralığı.
pub const STATS_INTERVAL: Duration = Duration::from_secs(2);

/// Mojang sürüm listesinin bellekte tutulma süresi.
pub const MANIFEST_TTL: Duration = Duration::from_secs(10 * 60);

pub const DEFAULT_PORT: u16 = 25565;
