//! Oyuncunun Microsoft hesabı: giriş, oturum (24 saatlik Minecraft token'ı), çıkış.
//! Yenileme token'ı işletim sisteminin kimlik kasasında (Windows Kimlik Bilgisi Yöneticisi) durur;
//! ad/UUID gibi gizli olmayan bilgiler `app_data/account.json`'da.

pub mod oauth;
pub mod xbox;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "mc-server-launcher";
const KEYRING_USER: &str = "microsoft-refresh-token";
/// Token'ın süresi dolmadan bu kadar önce yenilenir (oyun açılırken düşmesin).
const EXPIRY_MARGIN: Duration = Duration::from_secs(10 * 60);

/// Derlemede verilen Azure uygulama kimliği; yoksa Microsoft girişi kapalı.
pub fn client_id() -> Option<&'static str> {
    crate::consts::MS_CLIENT_ID.filter(|s| !s.trim().is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub uuid: String,
    pub skin: Option<String>,
}

#[derive(Clone)]
pub struct Session {
    pub account: Account,
    pub token: String,
    expires: Instant,
}

impl Session {
    fn fresh(&self) -> bool {
        self.expires > Instant::now() + EXPIRY_MARGIN
    }
}

fn keyring() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::msg(format!("Kimlik kasası açılamadı: {e}")))
}

pub struct AuthManager {
    http: reqwest::Client,
    account_file: PathBuf,
    session: Mutex<Option<Session>>,
}

impl AuthManager {
    pub fn new(http: reqwest::Client, data_dir: PathBuf) -> Self {
        Self {
            http,
            account_file: data_dir.join("account.json"),
            session: Mutex::new(None),
        }
    }

    pub fn account(&self) -> Option<Account> {
        std::fs::read(&self.account_file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
    }

    /// Tarayıcıda Microsoft girişi. `open` giriş sayfasını sistem tarayıcısında açar; `on_code`
    /// tarayıcı geri döndüğünde çağrılır (uygulama penceresi öne gelsin).
    pub async fn login(
        &self,
        open: impl FnOnce(&str) -> AppResult<()>,
        on_code: impl FnOnce(),
    ) -> AppResult<Account> {
        let client_id =
            client_id().ok_or_else(|| AppError::msg("Microsoft girişi bu sürümde kapalı."))?;
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let redirect = format!("http://localhost:{}", listener.local_addr()?.port());
        let pkce = oauth::pkce();
        let state = uuid::Uuid::new_v4().simple().to_string();
        open(&oauth::authorize_url(
            client_id,
            &redirect,
            &pkce.challenge,
            &state,
        ))?;
        let code = oauth::wait_for_code(listener, &state).await?;
        on_code();
        let tokens =
            oauth::exchange_code(&self.http, client_id, &code, &redirect, &pkce.verifier).await?;
        let session = self.complete(&tokens).await?;
        Ok(session.account)
    }

    /// Microsoft token'ından Minecraft oturumuna; yenileme anahtarı kasaya, hesap bilgisi dosyaya.
    async fn complete(&self, tokens: &oauth::MsTokens) -> AppResult<Session> {
        keyring()?
            .set_password(&tokens.refresh_token)
            .map_err(|e| AppError::msg(format!("Oturum kaydedilemedi: {e}")))?;
        let xbl = xbox::xbox_live(&self.http, &tokens.access_token).await?;
        let xsts = xbox::xsts(&self.http, &xbl).await?;
        let mc = xbox::minecraft_login(&self.http, &xsts).await?;
        if !xbox::owns_game(&self.http, &mc.access_token).await? {
            return Err(AppError::msg(
                "Bu Microsoft hesabında Minecraft: Java Edition yok.",
            ));
        }
        let profile = xbox::profile(&self.http, &mc.access_token).await?;
        let account = Account {
            name: profile.name,
            uuid: profile.id,
            skin: profile
                .skins
                .iter()
                .find(|s| s.state == "ACTIVE")
                .or(profile.skins.first())
                .map(|s| s.url.clone()),
        };
        std::fs::write(&self.account_file, serde_json::to_vec_pretty(&account)?)?;
        let session = Session {
            account,
            token: mc.access_token,
            expires: Instant::now() + Duration::from_secs(mc.expires_in),
        };
        *self.session.lock().await = Some(session.clone());
        Ok(session)
    }

    /// Geçerli oturum; süresi dolmak üzereyse kasadaki anahtarla yenilenir.
    pub async fn session(&self) -> AppResult<Session> {
        if let Some(s) = self.session.lock().await.as_ref().filter(|s| s.fresh()) {
            return Ok(s.clone());
        }
        let client_id =
            client_id().ok_or_else(|| AppError::msg("Microsoft girişi bu sürümde kapalı."))?;
        let refresh = keyring()?
            .get_password()
            .map_err(|_| AppError::msg("Microsoft hesabıyla giriş yapılmamış."))?;
        let tokens = oauth::refresh(&self.http, client_id, &refresh).await?;
        self.complete(&tokens).await
    }

    pub async fn logout(&self) {
        *self.session.lock().await = None;
        if let Ok(entry) = keyring() {
            let _ = entry.delete_credential();
        }
        let _ = std::fs::remove_file(&self.account_file);
    }
}
