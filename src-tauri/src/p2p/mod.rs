//! Uygulamalar arası doğrudan bağlantı (iroh). Önce delik açma (hole punching) ile doğrudan
//! bağlanılır; olmazsa trafik iroh'un aracı sunucusundan geçer (şimdilik n0'ın ücretsiz aracıları).
//!
//! - Host: gelen her akış `StreamHeader` ile başlar; `decide` kabul ederse `127.0.0.1:<port>`'a aktarılır.
//!   Minecraft bağlantısında `guard` varsa oyuncunun adı girişte okunur (`mc_login`) ve gerekirse
//!   oyuncu bir mesajla geri çevrilir (ad başka cihaza bağlı, cihaz yasaklı).
//! - Katılımcı: `ping` ile dünyanın durumunu sorar, `open_tcp` ile Minecraft bağlantısını taşır.

pub mod mc_login;
pub mod protocol;

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use iroh::endpoint::{Connection, RecvStream, SendStream, presets};
use iroh::{Endpoint, EndpointId, SecretKey};
use serde::Serialize;
use tokio::sync::Mutex;

use crate::client::manifest::ClientMod;
use crate::error::{AppError, AppResult};
use protocol::{ALPN, MAX_BODY, Reply, StreamHeader, StreamKind, read_body, read_line, write_line};

const KEY_FILE: &str = "iroh.key";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// Minecraft girişinin ilk iki paketi en çok bu kadar beklenir.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(10);

/// Bağlantının hangi yoldan gittiği (arayüzde "Doğrudan" / "Aracı sunucu üzerinden").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PathKind {
    Direct,
    Relay,
    Unknown,
}

/// Host'un bir akış için kararı.
pub enum Decision {
    /// Yalnız yanıt.
    Reply(Reply),
    /// Yanıt, sonra `127.0.0.1:<port>`'a iki yönlü aktarım. `Guard` varsa önce oyuncunun adına bakar.
    Tcp(Reply, u16, Option<Guard>),
    /// Yanıt, sonra gövde (mod listesi).
    Body(Reply, Vec<u8>),
    /// Yanıt, sonra dosyanın içeriği.
    File(Reply, std::path::PathBuf),
    /// Yanıt, sonra dosyanın [başlangıç, uzunluk] aralığı.
    FileRange(Reply, std::path::PathBuf, u64, u64),
}

/// Akışın başlığı ve bağlanan cihazın kimliği → karar.
pub type Decide = Arc<dyn Fn(&StreamHeader, &str) -> Decision + Send + Sync>;

/// Girişteki oyuncu adı → `Some(mesaj)` ise oyuncu bu mesajla geri çevrilir.
pub type Guard = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;

pub struct P2p {
    endpoint: Endpoint,
    conns: Mutex<HashMap<EndpointId, Connection>>,
}

/// Kimlik anahtarı kalıcıdır: davet linkleri uygulama yeniden açılınca da geçerli kalır.
fn load_or_create_key(dir: &Path) -> AppResult<SecretKey> {
    let path = dir.join(KEY_FILE);
    if let Ok(bytes) = std::fs::read(&path)
        && let Ok(arr) = <[u8; 32]>::try_from(bytes.as_slice())
    {
        return Ok(SecretKey::from_bytes(&arr));
    }
    let key = SecretKey::generate();
    std::fs::create_dir_all(dir)?;
    std::fs::write(&path, key.to_bytes())?;
    Ok(key)
}

fn path_kind(conn: &Connection) -> PathKind {
    match conn.paths().iter().find(|p| p.is_selected()) {
        Some(p) if p.is_relay() => PathKind::Relay,
        Some(_) => PathKind::Direct,
        None => PathKind::Unknown,
    }
}

impl P2p {
    pub async fn bind(app_data: &Path) -> AppResult<Arc<Self>> {
        let key = load_or_create_key(app_data)?;
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(key)
            .alpns(vec![ALPN.to_vec()])
            .bind()
            .await
            .map_err(|e| {
                AppError::msg(tx!(
                    "Doğrudan bağlantı başlatılamadı: {e}",
                    "Couldn't start the direct connection: {e}"
                ))
            })?;
        Ok(Arc::new(Self {
            endpoint,
            conns: Mutex::new(HashMap::new()),
        }))
    }

    pub fn id(&self) -> String {
        self.endpoint.id().to_string()
    }

    /// Bu cihazın kimliğiyle (Ed25519) imza: davet sunucusu ortak dünya isteklerini bununla doğrular.
    /// Anahtar dışarı verilmez.
    pub fn sign(&self, msg: &[u8]) -> [u8; 64] {
        self.endpoint.secret_key().sign(msg).to_bytes()
    }

    /// Test: karşı tarafın tam adresiyle bağlanıp bağlantıyı önbelleğe alır (adres yayılmasını beklemeden).
    #[cfg(test)]
    pub async fn dial(&self, other: &P2p) -> AppResult<()> {
        other.endpoint.online().await;
        let conn = self
            .endpoint
            .connect(other.endpoint.addr(), ALPN)
            .await
            .map_err(|e| AppError::msg(e.to_string()))?;
        self.conns.lock().await.insert(other.endpoint.id(), conn);
        Ok(())
    }

    pub async fn close(&self) {
        self.endpoint.close().await;
    }

    // ---- Host ----

    /// Gelen bağlantıları kabul eder; uygulama kapanana kadar çalışır.
    pub fn serve(self: &Arc<Self>, decide: Decide) {
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(incoming) = me.endpoint.accept().await {
                let decide = decide.clone();
                tauri::async_runtime::spawn(async move {
                    let Ok(conn) = incoming.await else { return };
                    let peer = conn.remote_id().to_string();
                    while let Ok((send, recv)) = conn.accept_bi().await {
                        let (decide, peer) = (decide.clone(), peer.clone());
                        tauri::async_runtime::spawn(async move {
                            let _ = handle_stream(send, recv, decide, &peer).await;
                        });
                    }
                });
            }
        });
    }

    // ---- Katılımcı ----

    async fn connection(&self, host: EndpointId) -> AppResult<Connection> {
        let mut conns = self.conns.lock().await;
        if let Some(c) = conns.get(&host)
            && c.close_reason().is_none()
        {
            return Ok(c.clone());
        }
        let conn = tokio::time::timeout(CONNECT_TIMEOUT, self.endpoint.connect(host, ALPN))
            .await
            .map_err(|_| {
                AppError::msg(tx!(
                    "Arkadaşının bilgisayarına ulaşılamadı (zaman aşımı).",
                    "Couldn't reach your friend's computer (timed out)."
                ))
            })?
            .map_err(|e| {
                AppError::msg(tx!(
                    "Arkadaşının bilgisayarına ulaşılamadı: {e}",
                    "Couldn't reach your friend's computer: {e}"
                ))
            })?;
        conns.insert(host, conn.clone());
        Ok(conn)
    }

    async fn open(
        &self,
        host: EndpointId,
        header: &StreamHeader,
    ) -> AppResult<(SendStream, RecvStream, Reply, PathKind)> {
        let conn = self.connection(host).await?;
        let (mut send, mut recv) = conn
            .open_bi()
            .await
            .map_err(|e| AppError::msg(e.to_string()))?;
        write_line(&mut send, header).await?;
        let reply: Reply = tokio::time::timeout(HEADER_TIMEOUT, read_line(&mut recv))
            .await
            .map_err(|_| {
                AppError::msg(tx!(
                    "Arkadaşının uygulaması yanıt vermedi.",
                    "Your friend's app didn't respond."
                ))
            })??;
        Ok((send, recv, reply, path_kind(&conn)))
    }

    pub async fn ping(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
    ) -> AppResult<(Reply, PathKind)> {
        let header = StreamHeader::new(world, token, StreamKind::Ping);
        let (mut send, _recv, reply, path) = self.open(host, &header).await?;
        let _ = send.finish();
        Ok((reply, path))
    }

    /// Arkadaşın dünyasında oyuncuya gidecek modların listesi.
    pub async fn manifest(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
    ) -> AppResult<Vec<ClientMod>> {
        let header = StreamHeader::new(world, token, StreamKind::Manifest);
        let (mut send, mut recv, reply, _) = self.open(host, &header).await?;
        let _ = send.finish();
        if !matches!(reply, Reply::Ok { .. }) {
            return Err(AppError::msg(tx!(
                "Davet artık geçerli değil.",
                "This invite is no longer valid."
            )));
        }
        let body = tokio::time::timeout(CONNECT_TIMEOUT, read_body(&mut recv, MAX_BODY))
            .await
            .map_err(|_| {
                AppError::msg(tx!(
                    "Mod listesi alınamadı (zaman aşımı).",
                    "Couldn't get the mod list (timed out)."
                ))
            })??;
        serde_json::from_slice(&body).map_err(|e| {
            AppError::msg(tx!(
                "Mod listesi okunamadı: {e}",
                "Couldn't read the mod list: {e}"
            ))
        })
    }

    /// Listedeki bir mod dosyasını arkadaşın bilgisayarından `dest`'e indirir (en fazla `max` bayt).
    pub async fn fetch_file(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
        file: &str,
        dest: &std::path::Path,
        max: u64,
    ) -> AppResult<()> {
        let header = StreamHeader {
            file: Some(file.into()),
            ..StreamHeader::new(world, token, StreamKind::File)
        };
        let (mut send, recv, reply, _) = self.open(host, &header).await?;
        let _ = send.finish();
        if !matches!(reply, Reply::Ok { .. }) {
            return Err(AppError::msg(tx!(
                "{file} arkadaşının bilgisayarından alınamadı.",
                "Couldn't get {file} from your friend's computer."
            )));
        }
        save_limited(recv, dest, max, file).await
    }

    /// Dünyanın kapağını arkadaşın bilgisayarından `dest`'e indirir (en fazla `max` bayt).
    pub async fn fetch_cover(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
        dest: &std::path::Path,
        max: u64,
    ) -> AppResult<()> {
        let header = StreamHeader::new(world, token, StreamKind::Cover);
        let (mut send, recv, reply, _) = self.open(host, &header).await?;
        let _ = send.finish();
        if !matches!(reply, Reply::Ok { .. }) {
            return Err(AppError::msg(tx!(
                "Kapak arkadaşının bilgisayarından alınamadı.",
                "Couldn't get the cover from your friend's computer."
            )));
        }
        save_limited(recv, dest, max, "cover").await
    }

    // ---- Ortak dünya ----

    /// Ortak dünya akışı: yanıt `Ok` değilse (nesil o cihazda yok, davet geçersiz) hata.
    async fn open_world(&self, host: EndpointId, header: &StreamHeader) -> AppResult<RecvStream> {
        let (mut send, recv, reply, _) = self.open(host, header).await?;
        let _ = send.finish();
        if !matches!(reply, Reply::Ok { .. }) {
            return Err(AppError::msg(tx!(
                "Dünyanın bu hâli arkadaşının bilgisayarında yok.",
                "Your friend's computer doesn't have this version of the world."
            )));
        }
        Ok(recv)
    }

    /// `gen` neslinin dosya listesi (JSON).
    pub async fn world_manifest(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
        generation: u64,
    ) -> AppResult<Vec<u8>> {
        let header = StreamHeader {
            generation: Some(generation),
            ..StreamHeader::new(world, token, StreamKind::WorldManifest)
        };
        let mut recv = self.open_world(host, &header).await?;
        Ok(read_body(&mut recv, crate::shared::MAX_MANIFEST).await?)
    }

    /// Bir dosyanın blok özetleri (8'er bayt).
    pub async fn world_blocks(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
        generation: u64,
        file: &str,
    ) -> AppResult<Vec<u8>> {
        let header = StreamHeader {
            generation: Some(generation),
            file: Some(file.into()),
            ..StreamHeader::new(world, token, StreamKind::WorldBlocks)
        };
        let mut recv = self.open_world(host, &header).await?;
        Ok(read_body(&mut recv, crate::shared::MAX_BLOCK_LIST).await?)
    }

    /// Bir dosyanın [başlangıç, uzunluk] aralığını okuyan akış.
    pub async fn world_read(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
        generation: u64,
        file: &str,
        range: [u64; 2],
    ) -> AppResult<RecvStream> {
        let header = StreamHeader {
            generation: Some(generation),
            file: Some(file.into()),
            range: Some(range),
            ..StreamHeader::new(world, token, StreamKind::WorldRead)
        };
        self.open_world(host, &header).await
    }

    /// Minecraft'ın bir TCP bağlantısını host'a taşır; bağlantı kapanana kadar sürer.
    pub async fn pipe_tcp(
        &self,
        host: EndpointId,
        world: &str,
        token: &str,
        mut tcp: tokio::net::TcpStream,
    ) -> AppResult<()> {
        let header = StreamHeader::new(world, token, StreamKind::Tcp);
        let (send, recv, reply, _) = self.open(host, &header).await?;
        if !matches!(reply, Reply::Ok { .. }) {
            return Err(AppError::msg(tx!(
                "Arkadaşının dünyası kapalı ya da davet geçersiz.",
                "Your friend's world is offline or the invite is invalid."
            )));
        }
        let mut stream = tokio::io::join(recv, send);
        let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
        Ok(())
    }
}

/// Gelen akışı `dest`'e yazar; `max`'tan büyükse dosyayı siler ve hata verir.
async fn save_limited(
    recv: RecvStream,
    dest: &std::path::Path,
    max: u64,
    name: &str,
) -> AppResult<()> {
    let mut out = tokio::fs::File::create(dest).await?;
    let copied =
        tokio::io::copy(&mut tokio::io::AsyncReadExt::take(recv, max + 1), &mut out).await?;
    if copied > max {
        drop(out);
        let _ = std::fs::remove_file(dest);
        return Err(AppError::msg(tx!(
            "{name} beklenenden büyük geldi.",
            "{name} was larger than expected."
        )));
    }
    Ok(())
}

async fn handle_stream(
    mut send: SendStream,
    mut recv: RecvStream,
    decide: Decide,
    peer: &str,
) -> std::io::Result<()> {
    let header: StreamHeader = tokio::time::timeout(HEADER_TIMEOUT, read_line(&mut recv))
        .await
        .map_err(|_| std::io::Error::other(tx!("başlık gelmedi", "no header received")))??;
    match decide(&header, peer) {
        Decision::Reply(reply) => {
            write_line(&mut send, &reply).await?;
            let _ = send.finish();
        }
        Decision::Tcp(reply, port, guard) => {
            write_line(&mut send, &reply).await?;
            let mut stream = tokio::io::join(recv, send);
            // Girişteki ad sunucuya gitmeden okunur; okunan baytlar sonra aynen iletilir.
            let first = match guard {
                Some(guard) => {
                    let login =
                        tokio::time::timeout(LOGIN_TIMEOUT, mc_login::read_login(&mut stream))
                            .await
                            .map_err(|_| {
                                std::io::Error::other(tx!("giriş gelmedi", "no login received"))
                            })??;
                    if let Some(message) = login.name.as_deref().and_then(|n| guard(n)) {
                        use tokio::io::AsyncWriteExt;
                        stream
                            .write_all(&mc_login::disconnect_packet(&message))
                            .await?;
                        let _ = stream.shutdown().await;
                        return Ok(());
                    }
                    login.consumed
                }
                None => Vec::new(),
            };
            let mut tcp =
                tokio::net::TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))
                    .await?;
            if !first.is_empty() {
                tokio::io::AsyncWriteExt::write_all(&mut tcp, &first).await?;
            }
            tokio::io::copy_bidirectional(&mut stream, &mut tcp).await?;
        }
        Decision::Body(reply, body) => {
            write_line(&mut send, &reply).await?;
            tokio::io::AsyncWriteExt::write_all(&mut send, &body).await?;
            let _ = send.finish();
        }
        Decision::File(reply, path) => {
            write_line(&mut send, &reply).await?;
            let mut file = tokio::fs::File::open(path).await?;
            tokio::io::copy(&mut file, &mut send).await?;
            let _ = send.finish();
        }
        Decision::FileRange(reply, path, start, len) => {
            use tokio::io::{AsyncReadExt, AsyncSeekExt};
            write_line(&mut send, &reply).await?;
            let mut file = tokio::fs::File::open(path).await?;
            file.seek(std::io::SeekFrom::Start(start)).await?;
            tokio::io::copy(&mut file.take(len), &mut send).await?;
            let _ = send.finish();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Canlı: aynı makinede iki endpoint. Host bir yerel TCP "echo" sunucusunu yayınlar,
    /// katılımcı ping atar ve TCP üzerinden veri gidip geldiğini doğrular.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn live_p2p_pipe() {
        let base = std::env::temp_dir().join(format!("mcsm-p2p-{}", uuid::Uuid::new_v4()));
        let host = P2p::bind(&base.join("host")).await.unwrap();
        let guest = P2p::bind(&base.join("guest")).await.unwrap();

        let file_path = base.join("a.jar");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(&file_path, b"jar").unwrap();
        let echo = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = echo.accept().await {
                tokio::spawn(async move {
                    let (mut r, mut w) = s.split();
                    let _ = tokio::io::copy(&mut r, &mut w).await;
                });
            }
        });

        host.serve(Arc::new(move |h: &StreamHeader, _peer: &str| {
            let ok = Reply::Ok {
                running: true,
                name: "Deneme".into(),
                mods_rev: None,
                cover: None,
                code: None,
            };
            match (h.world == "w" && h.token == "t", h.kind) {
                (false, _) => Decision::Reply(Reply::Denied),
                (true, StreamKind::Tcp) => Decision::Tcp(ok, port, None),
                (true, StreamKind::Manifest) => Decision::Body(ok, br#"[{"file":"a.jar","title":"A","sha1":"x","sha512":"y","size":3,"projectId":null,"versionId":null,"need":"required"}]"#.to_vec()),
                (true, StreamKind::File) => Decision::File(ok, file_path.clone()),
                (true, StreamKind::Ping | StreamKind::Cover) => Decision::Reply(ok),
                (true, _) => Decision::Reply(Reply::Denied),
            }
        }));

        let host_id: EndpointId = host.id().parse().unwrap();
        let (reply, path) = guest.ping(host_id, "w", "t").await.unwrap();
        println!("ping: {reply:?}, yol: {path:?}");
        assert!(matches!(reply, Reply::Ok { running: true, .. }));
        let (denied, _) = guest.ping(host_id, "w", "yanlis").await.unwrap();
        assert_eq!(denied, Reply::Denied);

        // Yerel bir dinleyici üzerinden: Minecraft'ın yapacağı gibi bağlan, yaz, oku.
        let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let local_port = local.local_addr().unwrap().port();
        let g = guest.clone();
        tokio::spawn(async move {
            let (tcp, _) = local.accept().await.unwrap();
            g.pipe_tcp(host_id, "w", "t", tcp).await.unwrap();
        });
        let mut client = tokio::net::TcpStream::connect(("127.0.0.1", local_port))
            .await
            .unwrap();
        client.write_all(b"merhaba minecraft").await.unwrap();
        let mut buf = [0u8; 17];
        client.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"merhaba minecraft");

        // Mod listesi ve dosya aktarımı.
        let list = guest.manifest(host_id, "w", "t").await.unwrap();
        assert_eq!(list.len(), 1);
        let dest = base.join("indirilen.jar");
        guest
            .fetch_file(host_id, "w", "t", "a.jar", &dest, 3)
            .await
            .unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"jar");
        assert!(
            guest
                .fetch_file(host_id, "w", "t", "a.jar", &base.join("k.jar"), 2)
                .await
                .is_err()
        );

        guest.close().await;
        host.close().await;
    }

    fn packet(body: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        mc_login::write_varint(&mut out, body.len() as i32);
        out.extend_from_slice(body);
        out
    }

    fn mc_string(s: &str) -> Vec<u8> {
        let mut out = Vec::new();
        mc_login::write_varint(&mut out, s.len() as i32);
        out.extend_from_slice(s.as_bytes());
        out
    }

    /// Minecraft'ın ilk iki paketi: el sıkışma (`next` 1 liste, 2 giriş) ve (girişse) Login Start.
    fn mc_hello(name: &str, next: i32) -> Vec<u8> {
        let mut hs = vec![0x00];
        mc_login::write_varint(&mut hs, 772);
        hs.extend(mc_string("localhost"));
        hs.extend_from_slice(&25565u16.to_be_bytes());
        mc_login::write_varint(&mut hs, next);
        let mut out = packet(&hs);
        if next != 1 {
            let mut ls = vec![0x00];
            ls.extend(mc_string(name));
            ls.extend_from_slice(&[0x22; 16]);
            out.extend(packet(&ls));
        }
        out
    }

    /// Canlı: kimlik koruması gerçek iroh bağlantısı üzerinden. İki farklı cihaz (iki katılımcı),
    /// arkada gelen her şeyi geri gönderen sahte bir Minecraft sunucusu.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn live_login_guard() {
        use crate::players_guard::{self, Check};
        let base = std::env::temp_dir().join(format!("mcsm-guard-{}", uuid::Uuid::new_v4()));
        let host = P2p::bind(&base.join("host")).await.unwrap();
        let a = P2p::bind(&base.join("a")).await.unwrap();
        let b = P2p::bind(&base.join("b")).await.unwrap();
        let meta = base.join("meta");

        let echo = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = echo.accept().await {
                tokio::spawn(async move {
                    let (mut r, mut w) = s.split();
                    let _ = tokio::io::copy(&mut r, &mut w).await;
                });
            }
        });

        let m = meta.clone();
        host.serve(Arc::new(move |_h: &StreamHeader, peer: &str| {
            let (m, device) = (m.clone(), peer.to_string());
            let guard: Guard = Arc::new(move |name: &str| {
                match players_guard::update(&m, |ids| {
                    ids.check(name, &device, true, Some("Sahip"), 1)
                })
                .unwrap()
                {
                    Check::Pass => None,
                    Check::NameTaken => Some("ad baskasinin".into()),
                    Check::Banned => Some("yasakli".into()),
                }
            });
            let ok = Reply::Ok {
                running: true,
                name: "Deneme".into(),
                mods_rev: None,
                cover: None,
                code: None,
            };
            Decision::Tcp(ok, port, Some(guard))
        }));
        let host_id: EndpointId = host.id().parse().unwrap();

        // Katılımcının yerel portuna bağlanıp ilk paketleri yollar; dönen ilk baytları okur.
        async fn attempt(guest: Arc<P2p>, host_id: EndpointId, hello: Vec<u8>) -> Vec<u8> {
            let local = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let local_port = local.local_addr().unwrap().port();
            tokio::spawn(async move {
                let (tcp, _) = local.accept().await.unwrap();
                let _ = guest.pipe_tcp(host_id, "w", "t", tcp).await;
            });
            let mut client = tokio::net::TcpStream::connect(("127.0.0.1", local_port))
                .await
                .unwrap();
            client.write_all(&hello).await.unwrap();
            let mut buf = vec![0u8; hello.len().max(64)];
            let n = tokio::time::timeout(Duration::from_secs(20), client.read(&mut buf))
                .await
                .unwrap()
                .unwrap();
            buf.truncate(n);
            buf
        }
        fn rejected_with(reply: &[u8], text: &str) -> bool {
            mc_login::read_varint(reply).is_some_and(|(_, n)| reply.get(n) == Some(&0x00))
                && String::from_utf8_lossy(reply).contains(text)
        }

        // 1. Cihaz A "Ali" ile girer: paketler sunucuya aynen gider (yankı geri gelir).
        let hello = mc_hello("Ali", 2);
        assert_eq!(attempt(a.clone(), host_id, hello.clone()).await, hello);
        // 2. Cihaz B aynı adla reddedilir; sahibin adıyla da.
        assert!(rejected_with(
            &attempt(b.clone(), host_id, mc_hello("ali", 2)).await,
            "ad baskasinin"
        ));
        assert!(rejected_with(
            &attempt(b.clone(), host_id, mc_hello("Sahip", 2)).await,
            "ad baskasinin"
        ));
        // 3. Sunucu listesi pingi kontrolsüz geçer.
        let ping = mc_hello("", 1);
        assert_eq!(attempt(b.clone(), host_id, ping.clone()).await, ping);
        // 4. B kendi adıyla girer.
        let veli = mc_hello("Veli", 2);
        assert_eq!(attempt(b.clone(), host_id, veli.clone()).await, veli);
        // 5. Ali'nin cihazı yasaklanınca başka adla da giremez.
        players_guard::update(&meta, |ids| ids.ban("Ali", 2)).unwrap();
        assert!(rejected_with(
            &attempt(a.clone(), host_id, mc_hello("Baska", 2)).await,
            "yasakli"
        ));
        assert_eq!(attempt(b.clone(), host_id, veli.clone()).await, veli);

        a.close().await;
        b.close().await;
        host.close().await;
    }
}
