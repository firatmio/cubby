//! Kısa davet kodları (`K7M-2QX`): uzun davet Cubby'nin davet sunucusunda (`consts::JOIN_WEB`,
//! Vercel + Redis) tutulur; kod ve web linki (`<JOIN_WEB>/join/<KOD>`) onu bulur.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::consts::{JOIN_WEB, LEGACY_URL_SCHEME, URL_SCHEME};
use crate::error::{AppError, AppResult};

/// Karışan karakterler (0/O, 1/I/L) yok; web tarafıyla aynı (`web/lib/code.ts`).
pub const ALPHABET: &str = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LEN: usize = 6;
const TIMEOUT: Duration = Duration::from_secs(6);

/// Host'ta dünya başına: kod, silme/tazeleme anahtarı ve hangi davet anahtarına ait olduğu.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortInvite {
    pub code: String,
    pub owner: String,
    pub token: String,
    /// Davet sunucusuna en son yüklenen kapağın sürümü (değişmedikçe yeniden yüklenmez).
    #[serde(default)]
    pub cover_sent: Option<u64>,
}

fn host_of(url: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()?
        .host_str()
        .map(str::to_ascii_lowercase)
}

/// `K7M-2QX`, `k7m2qx`, web linki (`/join/K7M2QX`, `/join?code=K7M2QX`) ve
/// `cubby://join?c=K7M2QX` → `K7M2QX`. Değilse `None` (eski `?d=` linki olabilir).
pub fn normalize(input: &str) -> Option<String> {
    let s = input.trim();
    let web = host_of(JOIN_WEB)?;
    let candidate = match s.split_once("://") {
        Some((scheme, rest))
            if scheme.eq_ignore_ascii_case(URL_SCHEME)
                || scheme.eq_ignore_ascii_case(LEGACY_URL_SCHEME) =>
        {
            let query = rest.split_once('?')?.1;
            query.split('&').find_map(|kv| kv.strip_prefix("c="))?
        }
        Some((scheme, rest))
            if scheme.eq_ignore_ascii_case("https") || scheme.eq_ignore_ascii_case("http") =>
        {
            path_code(rest, &web)?
        }
        Some(_) => return None,
        // Şemasız yapıştırılmış web linki: `cubby.quacomes.com/join/K7M2QX`.
        None if s.contains('/') => path_code(s, &web)?,
        None => s,
    };
    let code: String = candidate
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_ascii_uppercase();
    (code.len() == LEN && code.chars().all(|c| ALPHABET.contains(c))).then_some(code)
}

/// Serbest metinde (pano, sohbetten kopyalanmış mesaj) davet kodu: metnin kendisi kod olabilir ya da
/// içinde bir davet linki veya tireli kod (`K7M-2QX`) geçebilir. Tiresiz altı harf yalnız metnin
/// tamamıysa kabul edilir (sıradan bir kelime yanlışlıkla kod sanılmasın).
pub fn find_in_text(text: &str) -> Option<String> {
    let text = text.trim();
    if text.len() > 4096 {
        return None;
    }
    if let Some(code) = normalize(text) {
        return Some(code);
    }
    text.split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '/'))
        .filter(|w| {
            w.contains("/join")
                || w.contains("://")
                || (w.len() == LEN + 1 && w.as_bytes()[3] == b'-')
        })
        .find_map(normalize)
}

/// `host/join/KOD` ya da `host/join?code=KOD`; host davet sunucusu değilse `None`.
/// Kök (`host/...`) Cubby'nin tanıtım sitesine ayrıldı.
fn path_code<'a>(rest: &'a str, web: &str) -> Option<&'a str> {
    let (host, path) = rest.split_once('/')?;
    if !host.eq_ignore_ascii_case(web) {
        return None;
    }
    let path = path.split('#').next()?;
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    match path.trim_end_matches('/') {
        "join" => query.split('&').find_map(|kv| kv.strip_prefix("code=")),
        p => p.strip_prefix("join/").filter(|c| !c.contains('/')),
    }
}

/// Okunur biçim: `K7M-2QX`.
pub fn format(code: &str) -> String {
    format!("{}-{}", &code[..3], &code[3..])
}

pub fn web_link(code: &str) -> String {
    format!("{JOIN_WEB}/join/{code}")
}

fn unreachable(e: reqwest::Error) -> AppError {
    eprintln!("Davet sunucusu: {e}");
    AppError::msg(tx!(
        "Davet sunucusuna ulaşılamadı. İnternet bağlantını kontrol et ya da uzun davet kodunu kullan.",
        "Couldn't reach the invite server. Check your internet connection, or use the long invite code."
    ))
}

fn status_error(status: reqwest::StatusCode) -> AppError {
    match status.as_u16() {
        404 => AppError::msg(tx!(
            "Bu davet kodu bulunamadı ya da yenilenmiş. Arkadaşından yeni bir davet iste.",
            "This invite code wasn't found or was renewed. Ask your friend for a new invite."
        )),
        429 => AppError::msg(tx!(
            "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.",
            "Too many attempts. Wait a little and try again."
        )),
        _ => AppError::msg(tx!(
            "Davet sunucusu şu an yanıt vermiyor ({status}). Uzun davet kodunu kullanabilirsin.",
            "The invite server isn't responding right now ({status}). You can use the long invite code."
        )),
    }
}

async fn send(req: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
    let resp = req.timeout(TIMEOUT).send().await.map_err(unreachable)?;
    if resp.status().is_success() {
        Ok(resp)
    } else {
        Err(status_error(resp.status()))
    }
}

/// Uzun davet için yeni kısa kod: (kod, sahiplik anahtarı).
pub async fn create(http: &reqwest::Client, long: &str) -> AppResult<(String, String)> {
    #[derive(Deserialize)]
    struct Created {
        code: String,
        owner: String,
    }
    let c: Created = send(
        http.post(format!("{}/api/invites", web()))
            .json(&json!({ "invite": long })),
    )
    .await?
    .json()
    .await
    .map_err(unreachable)?;
    normalize(&c.code)
        .map(|code| (code, c.owner))
        .ok_or_else(|| status_error(reqwest::StatusCode::BAD_GATEWAY))
}

/// Tazeleme sonucu: `false` → kod sunucuda yok (süresi dolmuş), yenisi alınmalı.
pub async fn refresh(http: &reqwest::Client, s: &ShortInvite, long: &str) -> AppResult<bool> {
    let resp = http
        .put(format!("{}/api/invites/{}", web(), s.code))
        .json(&json!({ "owner": s.owner, "invite": long }))
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(unreachable)?;
    match resp.status().as_u16() {
        200..=299 => Ok(true),
        // Başka biri sahiplenmiş olamaz (anahtar bizde); kayıt yoksa ya da anahtar tutmuyorsa yenisi.
        403 | 404 => Ok(false),
        _ => Err(status_error(resp.status())),
    }
}

pub async fn delete(http: &reqwest::Client, s: &ShortInvite) -> AppResult<()> {
    send(
        http.delete(format!("{}/api/invites/{}", web(), s.code))
            .json(&json!({ "owner": s.owner })),
    )
    .await?;
    Ok(())
}

/// Davet sunucusunun adresi; testlerde `CUBBY_JOIN_WEB` ile (ör. önizleme dağıtımı) değiştirilebilir.
fn web() -> String {
    if cfg!(test)
        && let Ok(v) = std::env::var("CUBBY_JOIN_WEB")
    {
        return v;
    }
    JOIN_WEB.to_string()
}

/// Davet sayfasının bilgileri: davet edenin adı, oyuncuda gereken mod sayısı ve (varsa) kapak.
/// `cover`: `Some(None)` kapağı kaldırır, `None` dokunmaz.
pub async fn publish_meta(
    http: &reqwest::Client,
    s: &ShortInvite,
    host: Option<&str>,
    mods: usize,
    cover: Option<Option<(&[u8], u64)>>,
) -> AppResult<()> {
    use base64::Engine;
    let mut body = json!({ "owner": s.owner, "host": host, "mods": mods });
    match cover {
        Some(Some((jpeg, version))) => {
            body["cover"] = base64::engine::general_purpose::STANDARD
                .encode(jpeg)
                .into();
            body["coverVersion"] = version.into();
        }
        Some(None) => body["cover"] = serde_json::Value::Null,
        None => {}
    }
    send(
        http.put(format!("{}/api/invites/{}/meta", web(), s.code))
            .json(&body),
    )
    .await?;
    Ok(())
}

/// Dünyanın canlı durumu (davet sayfasında "Açık · 2 oyuncu oyunda").
pub async fn publish_status(
    http: &reqwest::Client,
    s: &ShortInvite,
    running: bool,
    players: usize,
    max_players: usize,
) -> AppResult<()> {
    send(
        http.put(format!("{}/api/invites/{}/status", web(), s.code))
            .json(&json!({
                "owner": s.owner,
                "running": running,
                "players": players,
                "maxPlayers": max_players,
            })),
    )
    .await?;
    Ok(())
}

/// Kısa kod → uzun davet kodu.
pub async fn resolve(http: &reqwest::Client, code: &str) -> AppResult<String> {
    #[derive(Deserialize)]
    struct Found {
        invite: String,
    }
    let f: Found = send(http.get(format!("{}/api/invites/{code}", web())))
        .await?
        .json()
        .await
        .map_err(unreachable)?;
    Ok(f.invite)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_records_have_no_cover_sent() {
        let s: ShortInvite =
            serde_json::from_str(r#"{"code":"K7M2QX","owner":"o","token":"t"}"#).unwrap();
        assert_eq!(s.cover_sent, None);
    }

    #[test]
    fn normalizes_codes_and_links() {
        assert_eq!(normalize("K7M2QX").as_deref(), Some("K7M2QX"));
        assert_eq!(normalize(" k7m-2qx ").as_deref(), Some("K7M2QX"));
        assert_eq!(normalize("K7M 2QX").as_deref(), Some("K7M2QX"));
        assert_eq!(normalize(&web_link("K7M2QX")).as_deref(), Some("K7M2QX"));
        for link in [
            format!("{JOIN_WEB}/join/k7m-2qx/"),
            format!("{JOIN_WEB}/join/K7M2QX?ref=x"),
            format!("{JOIN_WEB}/join?code=K7M2QX"),
            format!("{JOIN_WEB}/join/?ref=a&code=k7m2qx"),
            format!("{}/join/K7M2QX", JOIN_WEB.trim_start_matches("https://")),
        ] {
            assert_eq!(normalize(&link).as_deref(), Some("K7M2QX"), "{link}");
        }
        assert_eq!(
            normalize("cubby://join?c=K7M2QX").as_deref(),
            Some("K7M2QX")
        );
        assert_eq!(normalize("mcsm://join?c=k7m2qx").as_deref(), Some("K7M2QX"));
    }

    #[test]
    fn finds_codes_in_text() {
        assert_eq!(
            find_in_text(
                " k7m-2qx
"
            )
            .as_deref(),
            Some("K7M2QX")
        );
        assert_eq!(
            find_in_text(&format!(
                "Cubby'de dünyama gel: {} (kod K7M-2QX)",
                web_link("K7M2QX")
            ))
            .as_deref(),
            Some("K7M2QX")
        );
        assert_eq!(
            find_in_text("Kodum: Q4R-8TW, bekliyorum!").as_deref(),
            Some("Q4R8TW")
        );
        // Cümlenin içindeki sıradan altı harfli kelime kod sayılmaz; tek başınaysa sayılır.
        assert_eq!(find_in_text("bu akşam master dosyasını gönder"), None);
        assert_eq!(find_in_text("MASTER").as_deref(), Some("MASTER"));
        assert_eq!(find_in_text("https://evil.example/join/K7M2QX"), None);
        assert_eq!(find_in_text(""), None);
    }

    #[test]
    fn rejects_other_inputs() {
        for bad in [
            "",
            "K7M2Q",
            "K7M2QXX",
            "K0M2QX",
            "KIM2QX",
            "https://evil.example/join/K7M2QX",
            "https://cubby.quacomes.com/K7M2QX",
            "https://cubby.quacomes.com/about/K7M2QX",
            "https://cubby.quacomes.com/join/a/K7M2QX",
            "https://example.com/a/K7M2QX",
            "cubby://join?d=eyJ2IjoxfQ",
            "ftp://cubby.quacomes.com/K7M2QX",
            "eyJ2IjoxLCJuYW1lIjoiS2FyZGXFn2xlciJ9",
        ] {
            assert_eq!(normalize(bad), None, "{bad:?}");
        }
        assert_eq!(format("K7M2QX"), "K7M-2QX");
    }

    /// Canlı: davet sunucusunda oluştur → çöz → tazele → sil → bulunamadı.
    #[tokio::test]
    #[ignore]
    async fn live_short_invite_roundtrip() {
        let http = reqwest::Client::builder()
            .user_agent(crate::consts::USER_AGENT)
            .build()
            .unwrap();
        let long = crate::invite::Invite {
            v: crate::invite::INVITE_VERSION,
            name: "Canlı test".into(),
            host: iroh::SecretKey::generate().public().to_string(),
            world: uuid::Uuid::new_v4().to_string(),
            token: crate::invite::new_token(),
            loader: crate::loaders::LoaderKind::Fabric,
            mc_version: "1.21.1".into(),
            loader_version: Some("0.19.5".into()),
        }
        .encode();
        let (code, owner) = create(&http, &long).await.unwrap();
        assert_eq!(resolve(&http, &code).await.unwrap(), long);
        let s = ShortInvite {
            code: code.clone(),
            owner,
            token: String::new(),
            cover_sent: None,
        };
        assert!(refresh(&http, &s, &long).await.unwrap());
        let wrong = ShortInvite {
            owner: "0".repeat(32),
            ..s.clone()
        };
        assert!(!refresh(&http, &wrong, &long).await.unwrap());
        delete(&http, &s).await.unwrap();
        assert!(resolve(&http, &code).await.is_err());
    }
}
