pub mod vanilla;

use serde::{Deserialize, Serialize};

/// M2'de `Loader` trait'i ve Fabric/Paper buraya eklenecek.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoaderKind {
    Vanilla,
}

/// Arayüzde gösterilen oyun sürümü.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub release_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersionList {
    pub latest_release: String,
    pub versions: Vec<GameVersion>,
}
