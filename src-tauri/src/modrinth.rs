//! Modrinth API v2 (anahtarsız). Yalnız kullanılan alanlar; uç noktalar 2026-10-10'da canlı doğrulandı.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::loaders::LoaderKind;

const API: &str = "https://api.modrinth.com/v2";
pub const PAGE: u32 = 20;

/// Modrinth'te bu sunucu türünün dosyalarını çalıştırabilen loader'lar.
pub fn loaders_for(kind: LoaderKind) -> &'static [&'static str] {
    match kind {
        LoaderKind::Fabric => &["fabric"],
        LoaderKind::Paper => &["paper", "bukkit", "spigot", "purpur"],
        LoaderKind::NeoForge => &["neoforge"],
        LoaderKind::Forge => &["forge"],
        // Quilt, Fabric modlarını da çalıştırır.
        LoaderKind::Quilt => &["quilt", "fabric"],
        LoaderKind::Vanilla => &[],
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Required,
    Optional,
    Unsupported,
    #[serde(other)]
    Unknown,
}

/// Oyuncunun (istemcinin) bu moda ihtiyacı. Modrinth'in `environment` alanından.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientNeed {
    /// Oyuncuda da kurulu olmalı, yoksa giremez (yeni blok/eşya ekleyen modlar).
    Required,
    /// Sunucuda tek başına çalışır ama bazı özellikleri (ekranlar, tuşlar) oyuncuda da kuruluysa görünür.
    Recommended,
    /// Yalnız sunucuda yeterli.
    None,
    /// Yalnız oyuncuda çalışır; sunucuya kurmak işe yaramaz.
    ClientOnly,
    Unknown,
}

pub fn client_need(environment: &[String], client_side: Side) -> ClientNeed {
    let has = |v: &str| environment.iter().any(|e| e == v);
    if has("client_and_server") || client_side == Side::Required && !has("client_only") {
        ClientNeed::Required
    } else if has("client_only") || has("client_only_server_optional") || has("singleplayer_only") {
        ClientNeed::ClientOnly
    } else if has("client_or_server_prefers_both") || has("server_only_client_optional") {
        ClientNeed::Recommended
    } else if has("server_only")
        || has("dedicated_server_only")
        || has("client_or_server")
        || client_side == Side::Unsupported
    {
        ClientNeed::None
    } else {
        ClientNeed::Unknown
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sort {
    Relevance,
    Downloads,
    Updated,
}

impl Sort {
    fn index(self) -> &'static str {
        match self {
            Self::Relevance => "relevance",
            Self::Downloads => "downloads",
            Self::Updated => "updated",
        }
    }
}

/// Keşfet'teki içerik türleri. Modlar sunucuya, paketler oyuncunun Minecraft'ına ya da dünyaya kurulur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentKind {
    Mod,
    ResourcePack,
    Shader,
    DataPack,
}

impl ContentKind {
    /// Modrinth'te sürümlerin yükleyicileri (sürüm sorgusu ve güncelleme kontrolü için).
    pub fn loaders(self, world: LoaderKind) -> &'static [&'static str] {
        match self {
            Self::Mod => loaders_for(world),
            Self::ResourcePack => &["minecraft"],
            Self::Shader => &["iris", "optifine"],
            Self::DataPack => &["datapack"],
        }
    }

    /// İndirilecek dosyanın uzantısı.
    pub fn ext(self) -> &'static str {
        match self {
            Self::Mod => "jar",
            _ => "zip",
        }
    }
}

/// Paketlerin arama filtresi: türü ve sürümü uyan projeler (+ kategori).
pub fn content_facets(
    content: ContentKind,
    world: LoaderKind,
    mc: &str,
    category: Option<&str>,
) -> String {
    let mut groups: Vec<Vec<String>> = match content {
        ContentKind::Mod => return facets(world, mc, category),
        ContentKind::ResourcePack => vec![vec!["project_type:resourcepack".into()]],
        ContentKind::Shader => vec![
            vec!["project_type:shader".into()],
            // Iris, OptiFine biçimli paketleri de çalıştırır.
            vec!["categories:iris".into(), "categories:optifine".into()],
        ],
        ContentKind::DataPack => vec![vec!["project_type:datapack".into()]],
    };
    groups.push(vec![format!("versions:{mc}")]);
    if let Some(c) = category {
        groups.push(vec![format!("categories:{c}")]);
    }
    serde_json::to_string(&groups).expect("facet serileştirilemedi")
}

/// Arama filtresi: türüne ve sürümüne uyan, sunucuda çalışabilen projeler.
pub fn facets(kind: LoaderKind, mc: &str, category: Option<&str>) -> String {
    let mut groups = vec![
        loaders_for(kind)
            .iter()
            .map(|l| format!("categories:{l}"))
            .collect::<Vec<_>>(),
        vec![format!("versions:{mc}")],
        vec!["server_side:required".into(), "server_side:optional".into()],
    ];
    if let Some(c) = category {
        groups.push(vec![format!("categories:{c}")]);
    }
    // Mod paketleri de aynı loader kategorilerini taşır; yalnız tek tek modlar/eklentiler gelsin.
    groups.push(vec![
        if kind == LoaderKind::Paper {
            "project_type:plugin"
        } else {
            "project_type:mod"
        }
        .into(),
    ]);
    serde_json::to_string(&groups).expect("facet serileştirilemedi")
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchHit {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub client_side: Side,
    #[serde(default)]
    pub environment: Vec<String>,
    /// Öne çıkan galeri görseli (kartın büyük resmi).
    #[serde(default)]
    pub featured_gallery: Option<String>,
    /// İkondan çıkarılan baskın renk (RGB tamsayı).
    #[serde(default)]
    pub color: Option<u32>,
    #[serde(default)]
    pub author: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GalleryItem {
    pub url: String,
    #[serde(default)]
    pub featured: bool,
    #[serde(default)]
    pub ordering: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    pub total_hits: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct License {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub body: String,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub client_side: Side,
    #[serde(default)]
    pub environment: Vec<String>,
    pub license: Option<License>,
    #[serde(default)]
    pub gallery: Vec<GalleryItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DependencyType {
    Required,
    Optional,
    Incompatible,
    Embedded,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Dependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub dependency_type: DependencyType,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Hashes {
    pub sha1: String,
    pub sha512: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VersionFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub hashes: Hashes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VersionType {
    // Sıra önemli: küçük olan daha kararlı.
    Release,
    Beta,
    Alpha,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    pub version_number: String,
    pub version_type: VersionType,
    pub date_published: String,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
    pub files: Vec<VersionFile>,
}

pub struct Modrinth<'a> {
    http: &'a reqwest::Client,
}

fn api_error(e: reqwest::Error) -> AppError {
    AppError::msg(tx!(
        "Modrinth'e ulaşılamadı: {e}",
        "Couldn't reach Modrinth: {e}"
    ))
}

impl<'a> Modrinth<'a> {
    pub fn new(http: &'a reqwest::Client) -> Self {
        Self { http }
    }

    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> AppResult<T> {
        self.http
            .get(format!("{API}{path}"))
            .query(query)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(api_error)?
            .json()
            .await
            .map_err(api_error)
    }

    async fn post<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> AppResult<T> {
        self.http
            .post(format!("{API}{path}"))
            .json(&body)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(api_error)?
            .json()
            .await
            .map_err(api_error)
    }

    pub async fn search(
        &self,
        kind: LoaderKind,
        mc: &str,
        query: &str,
        category: Option<&str>,
        sort: Sort,
        offset: u32,
    ) -> AppResult<SearchResult> {
        self.search_content(ContentKind::Mod, kind, mc, query, category, sort, offset)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn search_content(
        &self,
        content: ContentKind,
        kind: LoaderKind,
        mc: &str,
        query: &str,
        category: Option<&str>,
        sort: Sort,
        offset: u32,
    ) -> AppResult<SearchResult> {
        self.get(
            "/search",
            &[
                ("query", query.to_string()),
                ("facets", content_facets(content, kind, mc, category)),
                ("index", sort.index().to_string()),
                ("offset", offset.to_string()),
                ("limit", PAGE.to_string()),
            ],
        )
        .await
    }

    pub async fn project(&self, id: &str) -> AppResult<Project> {
        self.get(&format!("/project/{}", encode(id)), &[]).await
    }

    pub async fn projects(&self, ids: &[String]) -> AppResult<Vec<Project>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        self.get(
            "/projects",
            &[("ids", serde_json::to_string(ids).unwrap_or_default())],
        )
        .await
    }

    pub async fn versions(&self, ids: &[String]) -> AppResult<Vec<Version>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        self.get(
            "/versions",
            &[("ids", serde_json::to_string(ids).unwrap_or_default())],
        )
        .await
    }

    pub async fn version(&self, id: &str) -> AppResult<Version> {
        self.get(&format!("/version/{}", encode(id)), &[]).await
    }

    /// Projenin bu tür ve sürüme uyan sürümleri (yeniden eskiye).
    pub async fn project_versions(
        &self,
        id: &str,
        kind: LoaderKind,
        mc: &str,
    ) -> AppResult<Vec<Version>> {
        self.project_versions_for(id, loaders_for(kind), mc).await
    }

    /// Projenin bu yükleyicilerle ve Minecraft sürümüyle uyumlu sürümleri.
    pub async fn project_versions_for(
        &self,
        id: &str,
        loaders: &[&str],
        mc: &str,
    ) -> AppResult<Vec<Version>> {
        let loaders = serde_json::to_string(loaders).unwrap_or_default();
        let versions = serde_json::to_string(&[mc]).unwrap_or_default();
        self.get(
            &format!("/project/{}/version", encode(id)),
            &[("loaders", loaders), ("game_versions", versions)],
        )
        .await
    }

    /// sha1 → sürüm (elle atılmış dosyaları tanımak için).
    pub async fn version_files(&self, sha1s: &[String]) -> AppResult<HashMap<String, Version>> {
        if sha1s.is_empty() {
            return Ok(HashMap::new());
        }
        self.post(
            "/version_files",
            json!({ "hashes": sha1s, "algorithm": "sha1" }),
        )
        .await
    }

    /// sha1 → bu tür ve sürüm için en yeni sürüm (güncelleme kontrolü).
    pub async fn latest_for(
        &self,
        sha1s: &[String],
        kind: LoaderKind,
        mc: &str,
    ) -> AppResult<HashMap<String, Version>> {
        self.latest_for_loaders(sha1s, loaders_for(kind), mc).await
    }

    pub async fn latest_for_loaders(
        &self,
        sha1s: &[String],
        loaders: &[&str],
        mc: &str,
    ) -> AppResult<HashMap<String, Version>> {
        if sha1s.is_empty() {
            return Ok(HashMap::new());
        }
        self.post(
            "/version_files/update",
            json!({ "hashes": sha1s, "algorithm": "sha1", "loaders": loaders, "game_versions": [mc] }),
        )
        .await
    }
}

/// Modrinth kimlikleri ve slug'lar yalnız güvenli karakterlerden oluşur; değilse istek yapılmaz.
fn encode(id: &str) -> String {
    if id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        id.to_string()
    } else {
        "_".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facets_by_kind() {
        let f: Vec<Vec<String>> =
            serde_json::from_str(&facets(LoaderKind::Paper, "26.3", Some("economy"))).unwrap();
        assert_eq!(
            f[0],
            vec![
                "categories:paper",
                "categories:bukkit",
                "categories:spigot",
                "categories:purpur"
            ]
        );
        assert_eq!(f[1], vec!["versions:26.3"]);
        assert_eq!(f[2], vec!["server_side:required", "server_side:optional"]);
        assert_eq!(f[3], vec!["categories:economy"]);
        assert_eq!(f[4], vec!["project_type:plugin"]);
        let f: Vec<Vec<String>> =
            serde_json::from_str(&facets(LoaderKind::Fabric, "1.21.11", None)).unwrap();
        assert_eq!(f.len(), 4);
        assert_eq!(f[0], vec!["categories:fabric"]);
        assert_eq!(f[3], vec!["project_type:mod"]);
    }

    #[test]
    fn facets_by_content() {
        let f = |c, cat| -> Vec<Vec<String>> {
            serde_json::from_str(&content_facets(c, LoaderKind::Fabric, "1.21.4", cat)).unwrap()
        };
        assert_eq!(
            f(ContentKind::ResourcePack, None)[0],
            vec!["project_type:resourcepack"]
        );
        assert_eq!(
            f(ContentKind::ResourcePack, None)[1],
            vec!["versions:1.21.4"]
        );
        let shader = f(ContentKind::Shader, Some("realistic"));
        assert_eq!(shader[1], vec!["categories:iris", "categories:optifine"]);
        assert_eq!(shader[3], vec!["categories:realistic"]);
        assert_eq!(
            f(ContentKind::DataPack, None)[0],
            vec!["project_type:datapack"]
        );
        // Modlar bugünkü filtreyle aynı.
        assert_eq!(f(ContentKind::Mod, None)[0], vec!["categories:fabric"]);
        assert_eq!(
            ContentKind::Shader.loaders(LoaderKind::Fabric),
            ["iris", "optifine"]
        );
        assert_eq!(
            ContentKind::Mod.loaders(LoaderKind::Quilt),
            ["quilt", "fabric"]
        );
        assert_eq!(ContentKind::DataPack.ext(), "zip");
    }

    #[test]
    fn client_need_from_environment() {
        let env = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // Modrinth'teki gerçek değerler (2026-10-10).
        assert_eq!(
            client_need(&env(&["client_or_server_prefers_both"]), Side::Optional),
            ClientNeed::Recommended
        ); // JEI
        assert_eq!(
            client_need(&env(&["client_and_server"]), Side::Optional),
            ClientNeed::Required
        ); // Farmer's Delight
        assert_eq!(
            client_need(&env(&["server_only"]), Side::Optional),
            ClientNeed::None
        ); // Styled Chat
        assert_eq!(
            client_need(&env(&["client_or_server"]), Side::Optional),
            ClientNeed::None
        ); // FerriteCore
        assert_eq!(
            client_need(&env(&["client_only"]), Side::Required),
            ClientNeed::ClientOnly
        ); // Sodium
        assert_eq!(client_need(&[], Side::Required), ClientNeed::Required);
        assert_eq!(client_need(&[], Side::Optional), ClientNeed::Unknown);
    }

    #[test]
    fn version_type_order() {
        assert!(VersionType::Release < VersionType::Beta && VersionType::Beta < VersionType::Alpha);
    }

    #[test]
    fn unsafe_ids_are_neutralised() {
        assert_eq!(encode("P7dR8mSH"), "P7dR8mSH");
        assert_eq!(encode("fabric-api"), "fabric-api");
        assert_eq!(encode("../x"), "_");
    }

    #[tokio::test]
    #[ignore]
    async fn live_modrinth_search() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let m = Modrinth::new(&http);
        let r = m
            .search(
                LoaderKind::Fabric,
                "26.3",
                "lithium",
                None,
                Sort::Relevance,
                0,
            )
            .await
            .unwrap();
        println!(
            "{} sonuç, ilk: {:?}",
            r.total_hits,
            r.hits.first().map(|h| &h.title)
        );
        assert!(r.hits.iter().any(|h| h.slug == "lithium"));
        let v = m
            .project_versions("lithium", LoaderKind::Fabric, "26.3")
            .await
            .unwrap();
        assert!(!v.is_empty());
    }
}
