//! Davet kodu ve linki: `{v, name, host, world, token, ...}` → JSON → base64url.
//! Link biçimi `<şema>://join?d=<kod>`; şema `consts::URL_SCHEME`.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};

use crate::consts::URL_SCHEME;
use crate::error::{AppError, AppResult};
use crate::loaders::LoaderKind;

pub const INVITE_VERSION: u32 = 1;
/// Makul bir davetten çok daha büyük kodlar reddedilir.
const MAX_CODE_LEN: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub v: u32,
    pub name: String,
    /// Host uygulamanın iroh kimliği (public key).
    pub host: String,
    /// Host tarafındaki dünya kimliği.
    pub world: String,
    pub token: String,
    pub loader: LoaderKind,
    pub mc_version: String,
    pub loader_version: Option<String>,
}

fn bad() -> AppError {
    AppError::msg("Davet kodu bozuk ya da eksik. Arkadaşından yeni bir davet iste.")
}

impl Invite {
    pub fn encode(&self) -> String {
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(self).expect("davet serileştirilemedi"))
    }

    pub fn link(&self) -> String {
        format!("{URL_SCHEME}://join?d={}", self.encode())
    }

    /// Düz kodu ya da linki kabul eder; alanları doğrular.
    pub fn parse(input: &str) -> AppResult<Self> {
        let input = input.trim();
        let code = match input.split_once("://") {
            Some((scheme, rest)) => {
                if !scheme.eq_ignore_ascii_case(URL_SCHEME) {
                    return Err(bad());
                }
                let query = rest.split_once('?').map(|(_, q)| q).ok_or_else(bad)?;
                query
                    .split('&')
                    .find_map(|kv| kv.strip_prefix("d="))
                    .ok_or_else(bad)?
            }
            None => input,
        };
        // Sohbet uygulamaları kodun sonuna/arasına boşluk ya da satır sonu ekleyebilir.
        let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
        if code.is_empty() || code.len() > MAX_CODE_LEN {
            return Err(bad());
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(code.trim_end_matches('='))
            .map_err(|_| bad())?;

        #[derive(Deserialize)]
        struct Version {
            v: u32,
        }
        let version: Version = serde_json::from_slice(&bytes).map_err(|_| bad())?;
        if version.v != INVITE_VERSION {
            return Err(AppError::msg(
                "Bu davet uygulamanın başka bir sürümüyle oluşturulmuş. İkiniz de uygulamayı güncelleyin.",
            ));
        }
        let invite: Invite = serde_json::from_slice(&bytes).map_err(|_| bad())?;
        invite.validate()?;
        Ok(invite)
    }

    fn validate(&self) -> AppResult<()> {
        let ok = !self.name.trim().is_empty()
            && self.name.chars().count() <= 64
            && self.host.parse::<iroh::EndpointId>().is_ok()
            && crate::paths::validate_id(&self.world).is_ok()
            && self.token.len() == 32
            && self.token.chars().all(|c| c.is_ascii_hexdigit())
            && valid_version(&self.mc_version)
            && self.loader_version.as_deref().is_none_or(valid_version);
        if ok { Ok(()) } else { Err(bad()) }
    }
}

/// Sürüm metinleri yalnız dosya adlarında güvenli karakterler içerebilir (klasör adı olarak kullanılır).
fn valid_version(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
        && !v.starts_with('.')
}

/// Dünya başına davet anahtarı: 16 rastgele bayt, hex.
pub fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Invite {
        Invite {
            v: INVITE_VERSION,
            name: "Kardeşlerle survival".into(),
            host: iroh::SecretKey::generate().public().to_string(),
            world: "a1b2c3d4-0000-4000-8000-000000000000".into(),
            token: new_token(),
            loader: LoaderKind::Fabric,
            mc_version: "26.3".into(),
            loader_version: Some("0.19.5".into()),
        }
    }

    #[test]
    fn roundtrip_code_and_link() {
        let inv = sample();
        assert_eq!(Invite::parse(&inv.encode()).unwrap(), inv);
        assert_eq!(Invite::parse(&inv.link()).unwrap(), inv);
        assert!(inv.link().starts_with(&format!("{URL_SCHEME}://join?d=")));
        // Arada satır sonu / boşluk olsa da çalışır.
        let code = inv.encode();
        let (a, b) = code.split_at(10);
        assert_eq!(Invite::parse(&format!(" {a}\n{b} ")).unwrap(), inv);
    }

    #[test]
    fn rejects_garbage_and_wrong_scheme() {
        assert!(Invite::parse("").is_err());
        assert!(Invite::parse("merhaba dünya").is_err());
        assert!(Invite::parse("https://join?d=abc").is_err());
        assert!(Invite::parse(&"a".repeat(MAX_CODE_LEN + 1)).is_err());
    }

    #[test]
    fn rejects_unknown_version_with_clear_message() {
        let mut inv = sample();
        inv.v = 99;
        let code = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&inv).unwrap());
        let err = Invite::parse(&code).unwrap_err().to_string();
        assert!(err.contains("güncelleyin"), "{err}");
    }

    #[test]
    fn rejects_unsafe_fields() {
        for f in [
            |i: &mut Invite| i.world = "../../etc".into(),
            |i: &mut Invite| i.mc_version = "..\\x".into(),
            |i: &mut Invite| i.token = "kisa".into(),
            |i: &mut Invite| i.host = "not-a-key".into(),
            |i: &mut Invite| i.loader_version = Some("a/b".into()),
        ] {
            let mut inv = sample();
            f(&mut inv);
            assert!(Invite::parse(&inv.encode()).is_err(), "{inv:?}");
        }
    }
}
