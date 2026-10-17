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
        http.post(format!("{JOIN_WEB}/api/invites"))
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
        .put(format!("{JOIN_WEB}/api/invites/{}", s.code))
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
        http.delete(format!("{JOIN_WEB}/api/invites/{}", s.code))
            .json(&json!({ "owner": s.owner })),
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
    let f: Found = send(http.get(format!("{JOIN_WEB}/api/invites/{code}")))
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
