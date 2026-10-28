//! Davet sunucusuyla ortak dünya konuşması (`web/api/shared*.ts`).
//!
//! Cihazın işlemleri (kira, nesil) imzalı gider: gövde `{payload, sig}`, imzalanan `payload` metninin
//! baytlarının kendisi (cihazın iroh anahtarıyla, Ed25519). Grubu sahip `owner` anahtarıyla yönetir.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{AppError, AppResult};
use crate::p2p::P2p;
use crate::short_invite::{ShortInvite, TIMEOUT, web};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    pub device: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Lease {
    pub device: String,
    #[serde(rename = "gen")]
    pub generation: u64,
    pub until: u64,
}

/// Sunucudaki durum: kimler açabilir, en güncel nesil, kimde hangi nesil, şu an kim açık.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct SharedState {
    pub owner: String,
    pub members: Vec<Member>,
    #[serde(rename = "gen")]
    pub generation: u64,
    pub holders: HashMap<String, u64>,
    pub lease: Option<Lease>,
    pub dirty: Option<String>,
}

impl SharedState {
    /// `generation` nesline sahip cihazlar (çekilecek kaynaklar).
    pub fn holders_of(&self, generation: u64) -> Vec<String> {
        self.holders
            .iter()
            .filter(|(_, g)| **g == generation)
            .map(|(d, _)| d.clone())
            .collect()
    }
}

/// Sunucunun geri çevirmesi (`web/lib/shared.ts` `Refusal`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "error", rename_all = "camelCase")]
pub enum Refusal {
    NotShared,
    NotMember,
    /// Başkası açık.
    Busy {
        device: String,
    },
    /// En güncel hâl bu cihazda kaldı; o dönene kadar beklenir.
    WaitFor {
        device: String,
    },
    /// Önce eşitle: bu nesil şu cihazlarda.
    NeedSync {
        #[serde(rename = "gen")]
        generation: u64,
        from: Vec<String>,
    },
    NoLease,
    BadGen {
        #[serde(rename = "gen")]
        generation: u64,
    },
    NoCopy,
}

/// Sonuç: durum ya da sunucunun gerekçeli reddi.
pub type Outcome = Result<SharedState, Refusal>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Act {
    State,
    Acquire,
    /// Açıkken dakikada bir; oyuncu sayısı davet sayfasına gider.
    Renew {
        players: u32,
        max_players: u32,
    },
    Publish(u64),
    Have(u64),
    Release,
}

/// İmzalanacak metin. Alan sırası önemsiz; sunucu bu metnin aynısını doğrular.
pub fn payload(act: Act, code: &str, device: &str, t: u64, nonce: &str) -> String {
    let (action, extra) = match act {
        Act::State => ("state", json!({})),
        Act::Acquire => ("acquire", json!({})),
        Act::Renew {
            players,
            max_players,
        } => (
            "renew",
            json!({ "players": players, "maxPlayers": max_players }),
        ),
        Act::Publish(g) => ("publish", json!({ "gen": g })),
        Act::Have(g) => ("have", json!({ "gen": g })),
        Act::Release => ("release", json!({})),
    };
    let mut v =
        json!({ "v": 1, "action": action, "code": code, "device": device, "t": t, "nonce": nonce });
    if let (Some(obj), Some(extra)) = (v.as_object_mut(), extra.as_object()) {
        obj.extend(extra.clone());
    }
    v.to_string()
}

#[derive(Deserialize)]
struct StateBody {
    shared: SharedState,
}

fn unreachable(e: reqwest::Error) -> AppError {
    AppError::msg(tx!(
        "Davet sunucusuna ulaşılamadı: {e}",
        "Couldn't reach the invite server: {e}"
    ))
}

/// 200 → durum, 404/409 → gerekçeli ret (gövdesi okunabiliyorsa), diğerleri hata.
async fn outcome(resp: reqwest::Response) -> AppResult<Outcome> {
    let status = resp.status();
    let body = resp.bytes().await.map_err(unreachable)?;
    if status.is_success() {
        return Ok(Ok(serde_json::from_slice::<StateBody>(&body)?.shared));
    }
    if let Ok(r) = serde_json::from_slice::<Refusal>(&body) {
        return Ok(Err(r));
    }
    if status.as_u16() == 404 {
        return Ok(Err(Refusal::NotShared));
    }
    Err(AppError::msg(tx!(
        "Davet sunucusu isteği geri çevirdi ({status}).",
        "The invite server refused the request ({status})."
    )))
}

/// Cihazın imzalı işlemi.
pub async fn act(http: &reqwest::Client, p2p: &P2p, code: &str, act: Act) -> AppResult<Outcome> {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let text = payload(act, code, &p2p.id(), t, &nonce);
    let sig = hex::encode(p2p.sign(text.as_bytes()));
    let resp = http
        .post(format!("{}/api/invites/{code}/shared/act", web()))
        .json(&json!({ "payload": text, "sig": sig }))
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(unreachable)?;
    outcome(resp).await
}

/// Sahip: ortak dünyayı açar (yoksa) ve üyeleri yazar.
pub async fn put_members(
    http: &reqwest::Client,
    s: &ShortInvite,
    members: &[Member],
) -> AppResult<Outcome> {
    let resp = http
        .put(format!("{}/api/invites/{}/shared", web(), s.code))
        .json(&json!({ "owner": s.owner, "members": members }))
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(unreachable)?;
    outcome(resp).await
}

/// Sahip: en güncel hâlin kaldığı cihaz dönmüyorsa beklemeyi kaldırır (o cihazın son ilerlemesi gider).
pub async fn force(http: &reqwest::Client, s: &ShortInvite) -> AppResult<Outcome> {
    let resp = http
        .post(format!("{}/api/invites/{}/shared/force", web(), s.code))
        .json(&json!({ "owner": s.owner }))
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(unreachable)?;
    outcome(resp).await
}

/// Sahip: ortak dünyayı kapatır.
pub async fn disable(http: &reqwest::Client, s: &ShortInvite) -> AppResult<()> {
    let resp = http
        .delete(format!("{}/api/invites/{}/shared", web(), s.code))
        .json(&json!({ "owner": s.owner }))
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(unreachable)?;
    if resp.status().is_success() || resp.status().as_u16() == 404 {
        Ok(())
    } else {
        Err(AppError::msg(tx!(
            "Davet sunucusu isteği geri çevirdi ({}).",
            "The invite server refused the request ({}).",
            resp.status()
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_shape() {
        let p = payload(
            Act::Renew {
                players: 2,
                max_players: 10,
            },
            "K7M2QX",
            "ab",
            5,
            "00",
        );
        let v: serde_json::Value = serde_json::from_str(&p).unwrap();
        assert_eq!(v["action"], "renew");
        assert_eq!(v["players"], 2);
        assert_eq!(v["maxPlayers"], 10);
        assert_eq!(v["v"], 1);
        let p = payload(Act::Publish(3), "K7M2QX", "ab", 5, "00");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&p).unwrap()["gen"],
            3
        );
    }

    #[test]
    fn refusals_parse() {
        let r: Refusal =
            serde_json::from_str(r#"{"error":"needSync","gen":3,"from":["aa"]}"#).unwrap();
        assert_eq!(
            r,
            Refusal::NeedSync {
                generation: 3,
                from: vec!["aa".into()]
            }
        );
        let r: Refusal = serde_json::from_str(r#"{"error":"waitFor","device":"bb"}"#).unwrap();
        assert_eq!(
            r,
            Refusal::WaitFor {
                device: "bb".into()
            }
        );
        let s: StateBody = serde_json::from_str(
            r#"{"shared":{"owner":"a","members":[{"device":"b","name":"Ayşe"}],"gen":2,"holders":{"a":2,"b":1},"lease":{"device":"a","gen":2,"until":9},"dirty":null}}"#,
        )
        .unwrap();
        assert_eq!(s.shared.holders_of(2), vec!["a".to_string()]);
    }

    /// Canlı: önizleme dağıtımına karşı (`CUBBY_JOIN_WEB`). Bir davet oluşturur, ortak dünyayı açar,
    /// bu cihazla kira alır, nesil yayınlar, bırakır, daveti siler. Web doğrulayıcısıyla imza uyumunu
    /// gerçek sunucuda gösterir.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn live_shared_web() {
        if std::env::var("CUBBY_JOIN_WEB").is_err() {
            println!("CUBBY_JOIN_WEB yok; atlandı");
            return;
        }
        let dir = crate::util::live_test_dir("shared-web");
        let p2p = P2p::bind(&dir).await.unwrap();
        let http = reqwest::Client::new();
        let invite = crate::invite::Invite {
            v: 1,
            name: "Canlı ortak dünya".into(),
            host: p2p.id(),
            world: "live-shared".into(),
            token: "0123456789abcdef0123456789abcdef".into(),
            loader: crate::loaders::LoaderKind::Fabric,
            mc_version: "26.3".into(),
            loader_version: Some("0.20.1".into()),
        };
        let (code, owner) = crate::short_invite::create(&http, &invite.encode())
            .await
            .unwrap();
        let s = ShortInvite {
            code: code.clone(),
            owner,
            token: invite.token.clone(),
            cover_sent: None,
            meta_sent: None,
            status_sent: None,
        };
        let st = put_members(&http, &s, &[]).await.unwrap().unwrap();
        assert_eq!(st.owner, p2p.id());
        let st = act(&http, &p2p, &code, Act::Acquire)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(st.lease.unwrap().device, p2p.id());
        let st = act(&http, &p2p, &code, Act::Publish(1))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(st.generation, 1);
        let r = act(&http, &p2p, &code, Act::Publish(1)).await.unwrap();
        assert_eq!(r, Err(Refusal::BadGen { generation: 1 }));
        let st = act(&http, &p2p, &code, Act::Release)
            .await
            .unwrap()
            .unwrap();
        assert!(st.lease.is_none());
        crate::short_invite::delete(&http, &s).await.unwrap();
        println!("canlı ortak dünya: {code} tamam");
    }
}
