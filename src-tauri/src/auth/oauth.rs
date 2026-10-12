//! Microsoft OAuth2 (kişisel hesaplar): PKCE'li yetki kodu akışı, `127.0.0.1` üzerinde tek seferlik
//! yönlendirme dinleyicisi, yenileme. Şifre Microsoft'un sayfasında girilir; uygulamaya hiç gelmez.

use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::error::{AppError, AppResult};

const AUTHORIZE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";

/// Kullanıcı tarayıcıda girişi bitirmezse dinleyici bu kadar bekler.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

/// RFC 7636: S256.
pub fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// 64 karakterlik rastgele doğrulayıcı (iki UUIDv4: işletim sisteminin güvenli rastgeleliğinden).
pub fn pkce() -> Pkce {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    Pkce {
        challenge: challenge_for(&verifier),
        verifier,
    }
}

pub fn authorize_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    reqwest::Url::parse_with_params(
        AUTHORIZE,
        &[
            ("client_id", client_id),
            ("response_type", "code"),
            ("redirect_uri", redirect),
            ("scope", SCOPE),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("state", state),
            ("prompt", "select_account"),
        ],
    )
    .map(|u| u.to_string())
    .unwrap_or_default()
}

/// Tarayıcının yönlendirdiği isteğin ilk satırından kod: `GET /?code=…&state=… HTTP/1.1`.
pub fn parse_callback(request_line: &str, state: &str) -> Option<Result<String, String>> {
    let target = request_line.split_whitespace().nth(1)?;
    let url = reqwest::Url::parse(&format!("http://localhost{target}")).ok()?;
    let get = |k: &str| {
        url.query_pairs()
            .find(|(key, _)| key == k)
            .map(|(_, v)| v.into_owned())
    };
    if let Some(err) = get("error") {
        return Some(Err(get("error_description").unwrap_or(err)));
    }
    let code = get("code")?;
    if get("state").as_deref() != Some(state) {
        return Some(Err("Giriş isteği eşleşmedi.".into()));
    }
    Some(Ok(code))
}

const PAGE_OK: &str = "<!doctype html><meta charset=utf-8><title>Giriş tamam</title>\
<body style=\"font-family:system-ui;background:#1b1b1b;color:#eee;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h2>Giriş tamam</h2><p>Bu sekmeyi kapatıp uygulamaya dönebilirsin.</p></div>";

const PAGE_FAIL: &str = "<!doctype html><meta charset=utf-8><title>Giriş olmadı</title>\
<body style=\"font-family:system-ui;background:#1b1b1b;color:#eee;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h2>Giriş olmadı</h2><p>Uygulamaya dönüp tekrar deneyebilirsin.</p></div>";

/// Yönlendirmeyi bekler; favicon gibi ilgisiz istekleri geçer.
pub async fn wait_for_code(listener: TcpListener, state: &str) -> AppResult<String> {
    let work = async {
        loop {
            let (mut sock, _) = listener.accept().await?;
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            let text = String::from_utf8_lossy(&buf[..n]);
            let line = text.lines().next().unwrap_or("");
            let Some(result) = parse_callback(line, state) else {
                let _ = sock
                    .write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                continue;
            };
            let page = if result.is_ok() { PAGE_OK } else { PAGE_FAIL };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                page.len()
            );
            let _ = sock.write_all(resp.as_bytes()).await;
            let _ = sock.shutdown().await;
            return result.map_err(|e| AppError::msg(format!("Microsoft girişi olmadı: {e}")));
        }
    };
    tokio::time::timeout(LOGIN_TIMEOUT, work)
        .await
        .map_err(|_| AppError::msg("Giriş zaman aşımına uğradı; tekrar dene."))?
}

#[derive(Debug, Deserialize)]
pub struct MsTokens {
    pub access_token: String,
    pub refresh_token: String,
}

#[derive(Deserialize)]
struct MsError {
    error: String,
    error_description: Option<String>,
}

async fn token_request(http: &reqwest::Client, form: &[(&str, &str)]) -> AppResult<MsTokens> {
    let resp = http.post(TOKEN).form(form).send().await?;
    if resp.status().is_success() {
        return Ok(resp.json().await?);
    }
    let err: Option<MsError> = resp.json().await.ok();
    Err(match err {
        // Yenileme anahtarının süresi dolmuş ya da iptal edilmiş: yeniden giriş gerekir.
        Some(e) if e.error == "invalid_grant" => {
            AppError::msg("Microsoft oturumunun süresi doldu; Ayarlar'dan yeniden giriş yap.")
        }
        Some(e) => AppError::msg(format!(
            "Microsoft girişi olmadı: {}",
            e.error_description.unwrap_or(e.error)
        )),
        None => AppError::msg("Microsoft girişi olmadı."),
    })
}

pub async fn exchange_code(
    http: &reqwest::Client,
    client_id: &str,
    code: &str,
    redirect: &str,
    verifier: &str,
) -> AppResult<MsTokens> {
    token_request(
        http,
        &[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect),
            ("code_verifier", verifier),
            ("scope", SCOPE),
        ],
    )
    .await
}

pub async fn refresh(
    http: &reqwest::Client,
    client_id: &str,
    refresh_token: &str,
) -> AppResult<MsTokens> {
    token_request(
        http,
        &[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("scope", SCOPE),
        ],
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let p = pkce();
        assert_eq!(p.verifier.len(), 64);
        assert_eq!(p.challenge, challenge_for(&p.verifier));
    }

    #[test]
    fn builds_authorize_url() {
        let url = authorize_url("abc", "http://localhost:5555", "ch", "st");
        assert!(url.starts_with(AUTHORIZE));
        assert!(url.contains("client_id=abc"));
        assert!(url.contains("redirect_uri=http%3A%2F%2Flocalhost%3A5555"));
        assert!(url.contains("scope=XboxLive.signin+offline_access"));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn parses_callback() {
        assert_eq!(
            parse_callback("GET /?code=M.C1_x&state=st HTTP/1.1", "st"),
            Some(Ok("M.C1_x".into()))
        );
        assert!(matches!(
            parse_callback("GET /?code=x&state=baska HTTP/1.1", "st"),
            Some(Err(_))
        ));
        assert_eq!(
            parse_callback(
                "GET /?error=access_denied&error_description=iptal HTTP/1.1",
                "st"
            ),
            Some(Err("iptal".into()))
        );
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "st"), None);
    }
}
