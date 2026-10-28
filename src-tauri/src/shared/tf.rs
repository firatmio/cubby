//! Test arkadaşı: ortak dünyayı tek bilgisayarda gerçek uygulamayla denemek için karşı taraf.
//! Kendi iroh kimliği ve deposu var (`CUBBY_TF_DIR`); her çağrı bir adım (`CUBBY_TF`):
//!
//! - `id`: kimliği yazar.
//! - `login`: kodun dünyasına (açık olmalı) "Ayse_Test" adıyla giriş paketi gönderir; sahip onu
//!   "açabilir" listesinde görür.
//! - `state`: davet sunucusundaki durum.
//! - `pull`: en güncel nesli çeker, "bende var" der.
//! - `host`: kirayı alır (gerekirse önce çeker), `CUBBY_TF_SECS` boyunca açık kalır: dakikada bir
//!   tazeler, gelen Minecraft bağlantılarını sahte bir sunucuya (yankı) bağlar; sonra bırakır.
//! - `owner`: `CUBBY_TF_SRC` sunucu klasöründen dünyanın sahibi olur, uygulamanın cihazını üye yapar
//!   ve `CUBBY_TF_SECS` boyunca dünyayı sunar (kapalı dünya gibi).
//!
//! `cargo test --release shared::tf -- --ignored --nocapture`

#![cfg(test)]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use iroh::EndpointId;
use tokio::io::AsyncWriteExt;

use super::web::{self, Act, Member, Refusal, SharedState};
use super::{Store, snapshot, sync};
use crate::invite::Invite;
use crate::p2p::protocol::{Reply, StreamHeader, StreamKind};
use crate::p2p::{Decision, P2p};

fn env(k: &str) -> String {
    std::env::var(k).unwrap_or_default()
}

fn dir() -> PathBuf {
    PathBuf::from(env("CUBBY_TF_DIR"))
}

fn ok(name: &str) -> Reply {
    Reply::Ok {
        running: true,
        name: name.into(),
        mods_rev: None,
        cover: None,
        code: None,
    }
}

fn frame(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    crate::p2p::mc_login::write_varint(&mut out, body.len() as i32);
    out.extend_from_slice(body);
    out
}

fn string(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    crate::p2p::mc_login::write_varint(&mut out, s.len() as i32);
    out.extend_from_slice(s.as_bytes());
    out
}

fn login_packets(name: &str) -> Vec<u8> {
    let mut hs = vec![0x00];
    crate::p2p::mc_login::write_varint(&mut hs, 772);
    hs.extend(string("127.0.0.1"));
    hs.extend_from_slice(&25565u16.to_be_bytes());
    crate::p2p::mc_login::write_varint(&mut hs, 2);
    let mut ls = vec![0x00];
    ls.extend(string(name));
    ls.extend_from_slice(&[0x22; 16]);
    [frame(&hs), frame(&ls)].concat()
}

async fn resolve(http: &reqwest::Client, code: &str) -> Invite {
    let long = crate::short_invite::resolve(http, code).await.unwrap();
    Invite::parse(&long).unwrap()
}

fn store(code: &str) -> Store {
    Store::at(dir().join(format!("store-{code}")))
}

async fn state(http: &reqwest::Client, p2p: &P2p, code: &str) -> SharedState {
    match web::act(http, p2p, code, Act::State).await.unwrap() {
        Ok(s) => s,
        Err(r) => panic!("durum alınamadı: {r:?}"),
    }
}

async fn pull(http: &reqwest::Client, p2p: &P2p, code: &str, invite: &Invite, s: &SharedState) {
    let peers: Vec<EndpointId> = s
        .holders_of(s.generation)
        .iter()
        .filter_map(|d| d.parse().ok())
        .collect();
    let src = sync::Source {
        p2p,
        peers: &peers,
        world: &invite.world,
        token: &invite.token,
    };
    let (m, stats) = sync::pull(&src, &store(code), s.generation, |_, _| {})
        .await
        .unwrap();
    println!(
        "TA çekti: nesil {}, {} dosya, {:.1} MB",
        m.generation,
        stats.files,
        stats.bytes as f64 / 1048576.0
    );
    let r = web::act(http, p2p, code, Act::Have(s.generation))
        .await
        .unwrap();
    println!("TA have {}: {:?}", s.generation, r.map(|s| s.holders));
}

/// Sahte Minecraft sunucusu: bağlananın gönderdiğini geri yollar, gelen baytları sayar.
async fn echo_server() -> u16 {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut s, peer)) = l.accept().await {
            println!("TA sahte sunucu: bağlantı geldi ({peer})");
            tokio::spawn(async move {
                let (mut r, mut w) = s.split();
                let n = tokio::io::copy(&mut r, &mut w).await.unwrap_or(0);
                println!("TA sahte sunucu: {n} bayt yankılandı");
            });
        }
    });
    port
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn tf() {
    let step = env("CUBBY_TF");
    let code = env("CUBBY_TF_CODE");
    let secs: u64 = env("CUBBY_TF_SECS").parse().unwrap_or(120);
    let p2p = P2p::bind(&dir()).await.unwrap();
    let http = reqwest::Client::new();
    println!("TA kimlik: {}", p2p.id());
    match step.as_str() {
        "id" => {}
        "login" => {
            let inv = resolve(&http, &code).await;
            let host: EndpointId = inv.host.parse().unwrap();
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let mut client = tokio::net::TcpStream::connect(l.local_addr().unwrap())
                .await
                .unwrap();
            let (server_side, _) = l.accept().await.unwrap();
            let (p, w, t) = (p2p.clone(), inv.world.clone(), inv.token.clone());
            let pipe = tokio::spawn(async move { p.pipe_tcp(host, &w, &t, server_side).await });
            client.write_all(&login_packets("Ayse_Test")).await.unwrap();
            tokio::time::sleep(Duration::from_secs(3)).await;
            drop(client);
            println!(
                "TA giriş gönderildi: {:?}",
                tokio::time::timeout(Duration::from_secs(5), pipe)
                    .await
                    .map(|r| r.map(|r| r.map_err(|e| e.to_string())))
            );
        }
        "joinlive" => {
            // Sahibin davetiyle (dünya kimliği ve token) şu an açık olana bağlanır; sunucunun yanıtı okunur.
            let inv = resolve(&http, &code).await;
            // Grupta olmayan arkadaş: açık olanı davetin herkese açık çözümünden öğrenir.
            let v: serde_json::Value = http
                .get(format!("{}/api/invites/{code}", crate::short_invite::web()))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            let live: EndpointId = v["live"]["device"]
                .as_str()
                .expect("açık olan yok")
                .parse()
                .unwrap();
            println!("TA açık olan: {}", &live.to_string()[..8]);
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let mut client = tokio::net::TcpStream::connect(l.local_addr().unwrap())
                .await
                .unwrap();
            let (server_side, _) = l.accept().await.unwrap();
            let (p, w, t) = (p2p.clone(), inv.world.clone(), inv.token.clone());
            tokio::spawn(async move {
                println!(
                    "TA boru: {:?}",
                    p.pipe_tcp(live, &w, &t, server_side)
                        .await
                        .map_err(|e| e.to_string())
                )
            });
            client.write_all(&login_packets("Ayse_Test")).await.unwrap();
            let mut buf = vec![0u8; 512];
            let n = tokio::time::timeout(
                Duration::from_secs(10),
                tokio::io::AsyncReadExt::read(&mut client, &mut buf),
            )
            .await;
            println!(
                "TA sunucudan yanıt: {:?} bayt, ilk baytlar {:?}",
                n.as_ref().map(|r| r.as_ref().ok()),
                &buf[..8]
            );
        }
        "state" => {
            let s = state(&http, &p2p, &code).await;
            println!(
                "TA durum: nesil {}, kira {:?}, kirli {:?}, holders {:?}, üyeler {:?}",
                s.generation, s.lease, s.dirty, s.holders, s.members
            );
        }
        "pull" => {
            let inv = resolve(&http, &code).await;
            let s = state(&http, &p2p, &code).await;
            pull(&http, &p2p, &code, &inv, &s).await;
        }
        "host" => {
            let inv = resolve(&http, &code).await;
            for _ in 0..3 {
                match web::act(&http, &p2p, &code, Act::Acquire).await.unwrap() {
                    Ok(_) => break,
                    Err(Refusal::NeedSync { .. }) => {
                        let s = state(&http, &p2p, &code).await;
                        pull(&http, &p2p, &code, &inv, &s).await;
                    }
                    Err(r) => panic!("kira alınamadı: {r:?}"),
                }
            }
            println!("TA kirayı aldı");
            let port = echo_server().await;
            let st = Arc::new(store(&code));
            let (world, token) = (inv.world.clone(), inv.token.clone());
            p2p.serve(Arc::new(move |h: &StreamHeader, peer: &str| {
                println!("TA akış: {:?} ({})", h.kind, &peer[..8]);
                if h.world != world || h.token != token {
                    return Decision::Reply(Reply::Denied);
                }
                match h.kind {
                    StreamKind::Ping => Decision::Reply(ok("Ortak test")),
                    StreamKind::Tcp => Decision::Tcp(ok("Ortak test"), port, None),
                    StreamKind::WorldManifest | StreamKind::WorldBlocks | StreamKind::WorldRead => {
                        st.serve(h, ok(""))
                    }
                    _ => Decision::Reply(Reply::Denied),
                }
            }));
            let until = tokio::time::Instant::now() + Duration::from_secs(secs);
            while tokio::time::Instant::now() < until {
                let r = web::act(
                    &http,
                    &p2p,
                    &code,
                    Act::Renew {
                        players: 1,
                        max_players: 10,
                    },
                )
                .await
                .unwrap();
                println!("TA tazeledi: {:?}", r.map(|s| s.lease));
                tokio::time::sleep(
                    Duration::from_secs(60).min(until - tokio::time::Instant::now()),
                )
                .await;
            }
            if env("CUBBY_TF_CRASH") == "1" {
                println!("TA çöktü gibi: kira bırakılmadan çıkılıyor");
                return;
            }
            println!(
                "TA bırakıyor: {:?}",
                web::act(&http, &p2p, &code, Act::Release)
                    .await
                    .unwrap()
                    .map(|s| s.lease)
            );
        }
        "owner" => {
            let app_key = std::fs::read(env("CUBBY_TF_APP_KEY")).unwrap();
            let app_dev =
                iroh::SecretKey::from_bytes(&<[u8; 32]>::try_from(app_key.as_slice()).unwrap())
                    .public()
                    .to_string();
            let invite = Invite {
                v: 1,
                name: "TA'nın ortak dünyası".into(),
                host: p2p.id(),
                world: "ta-world".into(),
                token: "fedcba9876543210fedcba9876543210".into(),
                loader: crate::loaders::LoaderKind::Vanilla,
                mc_version: env("CUBBY_TF_MC"),
                loader_version: None,
            };
            let code = match std::fs::read_to_string(dir().join("owner-code.txt")) {
                Ok(c) => c,
                Err(_) => {
                    let (c, owner) = crate::short_invite::create(&http, &invite.encode())
                        .await
                        .unwrap();
                    std::fs::write(dir().join("owner-code.txt"), &c).unwrap();
                    std::fs::write(dir().join("owner-secret.txt"), &owner).unwrap();
                    c
                }
            };
            let s = crate::short_invite::ShortInvite {
                code: code.clone(),
                owner: std::fs::read_to_string(dir().join("owner-secret.txt")).unwrap(),
                token: invite.token.clone(),
                cover_sent: None,
                meta_sent: None,
                status_sent: None,
            };
            println!(
                "TA sahip: kod {} (uygulamada Katıl'a yaz: {})",
                code,
                crate::short_invite::format(&code)
            );
            let st = web::put_members(
                &http,
                &s,
                &[Member {
                    device: app_dev.clone(),
                    name: "Firat_App".into(),
                }],
            )
            .await
            .unwrap()
            .unwrap();
            println!(
                "TA grup: üyeler {:?}, nesil {}",
                st.members.iter().map(|m| &m.name).collect::<Vec<_>>(),
                st.generation
            );
            let store = Arc::new(Store::at(dir().join("owner-store")));
            if st.generation == 0 {
                web::act(&http, &p2p, &code, Act::Acquire)
                    .await
                    .unwrap()
                    .unwrap();
                let m = snapshot::snapshot(std::path::Path::new(&env("CUBBY_TF_SRC")), &store, 1)
                    .unwrap()
                    .unwrap();
                println!("TA ilk nesil: {} dosya", m.files.len());
                println!(
                    "TA publish: {:?}",
                    web::act(&http, &p2p, &code, Act::Publish(1))
                        .await
                        .unwrap()
                        .map(|s| s.generation)
                );
                web::act(&http, &p2p, &code, Act::Release)
                    .await
                    .unwrap()
                    .unwrap();
            }
            let (world, token) = (invite.world.clone(), invite.token.clone());
            let serve_store = store.clone();
            p2p.serve(Arc::new(move |h: &StreamHeader, peer: &str| {
                println!("TA akış: {:?} ({})", h.kind, &peer[..8]);
                if h.world != world || h.token != token {
                    return Decision::Reply(Reply::Denied);
                }
                let closed = Reply::Ok {
                    running: false,
                    name: "TA'nın ortak dünyası".into(),
                    mods_rev: None,
                    cover: None,
                    code: None,
                };
                match h.kind {
                    StreamKind::Ping => Decision::Reply(closed),
                    StreamKind::Manifest => Decision::Body(closed, b"[]".to_vec()),
                    StreamKind::Tcp => Decision::Reply(Reply::Offline),
                    StreamKind::WorldManifest | StreamKind::WorldBlocks | StreamKind::WorldRead => {
                        serve_store.serve(h, closed)
                    }
                    _ => Decision::Reply(Reply::Denied),
                }
            }));
            let until = tokio::time::Instant::now() + Duration::from_secs(secs);
            while tokio::time::Instant::now() < until {
                let s = state(&http, &p2p, &code).await;
                println!(
                    "TA izliyor: nesil {}, kira {:?}, holders {:?}",
                    s.generation,
                    s.lease.map(|l| l.device[..8].to_string()),
                    s.holders
                );
                tokio::time::sleep(Duration::from_secs(20)).await;
            }
        }
        other => panic!("bilinmeyen adım: {other}"),
    }
}
