//! Microsoft token'ı → Xbox Live → XSTS → Minecraft token'ı; oyun sahipliği ve profil.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::{AppError, AppResult};

const XBL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS: &str = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

/// Uygulama kimliği Mojang'dan onay almadıysa son adım bu kodla düşer; arayüz kendi metnini gösterir.
pub const NOT_APPROVED: &str = "NOT_APPROVED";

#[derive(Debug, Clone)]
pub struct XboxToken {
    pub token: String,
    pub uhs: String,
}

fn parse_xbox(v: &Value) -> Option<XboxToken> {
    Some(XboxToken {
        token: v.get("Token")?.as_str()?.to_string(),
        uhs: v.pointer("/DisplayClaims/xui/0/uhs")?.as_str()?.to_string(),
    })
}

/// XSTS'nin 401 `XErr` kodları; sade Türkçe.
pub fn xerr_message(code: u64) -> String {
    match code {
        2148916227 => tx!(
            "Bu Microsoft hesabı Xbox'ta engellenmiş.",
            "This Microsoft account is banned on Xbox."
        ),
        2148916233 => {
            tx!(
                "Bu Microsoft hesabının Xbox profili yok. Bir kez xbox.com'a giriş yapıp profil oluştur, sonra tekrar dene.",
                "This Microsoft account has no Xbox profile. Sign in to xbox.com once to create one, then try again."
            )
        }
        2148916235 => tx!(
            "Xbox Live bu hesabın ülkesinde kullanılamıyor.",
            "Xbox Live isn't available in this account's country."
        ),
        2148916236 | 2148916237 => tx!(
            "Bu hesap için Xbox'ta yetişkin doğrulaması gerekiyor.",
            "This account needs adult verification on Xbox."
        ),
        2148916238 => {
            tx!(
                "Bu bir çocuk hesabı: bir yetişkinin hesabı Microsoft Aile grubuna eklemesi gerekiyor.",
                "This is a child account: an adult needs to add it to a Microsoft Family group."
            )
        }
        other => tx!(
            "Xbox girişi olmadı (kod {other}).",
            "Xbox sign-in failed (code {other})."
        ),
    }
}

pub async fn xbox_live(http: &reqwest::Client, ms_access: &str) -> AppResult<XboxToken> {
    let body = json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={ms_access}"),
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT",
    });
    let v: Value = http
        .post(XBL)
        .json(&body)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| {
            AppError::msg(tx!(
                "Xbox Live girişi olmadı: {e}",
                "Xbox Live sign-in failed: {e}"
            ))
        })?
        .json()
        .await?;
    parse_xbox(&v).ok_or_else(|| {
        AppError::msg(tx!(
            "Xbox Live yanıtı okunamadı.",
            "Couldn't read the Xbox Live response."
        ))
    })
}

pub async fn xsts(http: &reqwest::Client, xbl: &XboxToken) -> AppResult<XboxToken> {
    let body = json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl.token] },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT",
    });
    let resp = http.post(XSTS).json(&body).send().await?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let v: Value = resp.json().await.unwrap_or(Value::Null);
        let code = v.get("XErr").and_then(Value::as_u64).unwrap_or(0);
        return Err(AppError::msg(xerr_message(code)));
    }
    let v: Value = resp
        .error_for_status()
        .map_err(|e| AppError::msg(tx!("Xbox girişi olmadı: {e}", "Xbox sign-in failed: {e}")))?
        .json()
        .await?;
    parse_xbox(&v).ok_or_else(|| {
        AppError::msg(tx!(
            "Xbox yanıtı okunamadı.",
            "Couldn't read the Xbox response."
        ))
    })
}

#[derive(Debug, Deserialize)]
pub struct McLogin {
    pub access_token: String,
    pub expires_in: u64,
}

pub async fn minecraft_login(http: &reqwest::Client, xsts: &XboxToken) -> AppResult<McLogin> {
    let body = json!({ "identityToken": format!("XBL3.0 x={};{}", xsts.uhs, xsts.token) });
    let resp = http.post(MC_LOGIN).json(&body).send().await?;
    if resp.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::msg(format!(
            "[{NOT_APPROVED}] {}",
            tx!(
                "Uygulamanın Microsoft girişi için Mojang onayı bekleniyor. Şimdilik oyun Launcher'la açılıyor.",
                "Microsoft sign-in for this app is waiting for Mojang's approval. For now the game opens through the Launcher."
            )
        )));
    }
    Ok(resp
        .error_for_status()
        .map_err(|e| {
            AppError::msg(tx!(
                "Minecraft girişi olmadı: {e}",
                "Minecraft sign-in failed: {e}"
            ))
        })?
        .json()
        .await?)
}

/// Hesapta Minecraft: Java Edition var mı (Game Pass dahil).
pub async fn owns_game(http: &reqwest::Client, mc_token: &str) -> AppResult<bool> {
    let v: Value = http
        .get(MC_ENTITLEMENTS)
        .bearer_auth(mc_token)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(owns_from(&v))
}

pub fn owns_from(v: &Value) -> bool {
    v.get("items")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|i| {
                matches!(
                    i.get("name").and_then(Value::as_str),
                    Some("game_minecraft" | "product_minecraft")
                )
            })
        })
}

#[derive(Debug, Clone, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<Skin>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Skin {
    pub url: String,
    #[serde(default)]
    pub state: String,
}

pub async fn profile(http: &reqwest::Client, mc_token: &str) -> AppResult<Profile> {
    let resp = http.get(MC_PROFILE).bearer_auth(mc_token).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::msg(tx!(
            "Bu hesapta Minecraft profili yok. Minecraft Launcher'a bir kez giriş yapıp oyuncu adını seç.",
            "This account has no Minecraft profile. Sign in to the Minecraft Launcher once and pick a player name."
        )));
    }
    Ok(resp.error_for_status()?.json().await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_xbox_and_entitlements() {
        let v = json!({"Token": "t", "DisplayClaims": {"xui": [{"uhs": "123"}]}});
        let x = parse_xbox(&v).unwrap();
        assert_eq!((x.token.as_str(), x.uhs.as_str()), ("t", "123"));
        assert!(parse_xbox(&json!({"Token": "t"})).is_none());

        assert!(owns_from(
            &json!({"items": [{"name": "product_minecraft"}, {"name": "game_minecraft"}]})
        ));
        assert!(!owns_from(&json!({"items": []})));
        assert!(!owns_from(
            &json!({"items": [{"name": "product_dungeons"}]})
        ));
    }

    #[test]
    fn explains_xerr() {
        assert!(xerr_message(2148916233).contains("Xbox profili yok"));
        assert!(xerr_message(2148916238).contains("çocuk"));
        assert!(xerr_message(1).contains("kod 1"));
    }
}
