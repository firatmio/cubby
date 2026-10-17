//! Uygulamalar arası akış başlığı: her bi-stream bir JSON satırıyla (`\n`) başlar.

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Uygulamanın iroh ALPN'i. Protokol değişirse sürüm artar.
pub const ALPN: &[u8] = b"mcsm/mc/1";
/// Başlık ve yanıt satırları için üst sınır.
pub const MAX_LINE: usize = 1024;
/// Mod listesi gövdesi için üst sınır.
pub const MAX_BODY: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamKind {
    /// Dünya açık mı?
    Ping,
    /// Minecraft TCP bağlantısı; başlıktan sonra ham bayt aktarılır.
    Tcp,
    /// Oyuncuya gidecek mod listesi (yanıttan sonra JSON gövde).
    Manifest,
    /// Listedeki bir mod dosyası (yanıttan sonra ham bayt). Dosya adı `file` alanında.
    File,
    /// Dünyanın kapağı (JPEG, yanıttan sonra ham bayt): arkadaşta da aynı arka plan görünsün.
    Cover,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamHeader {
    pub world: String,
    pub token: String,
    pub kind: StreamKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum Reply {
    /// Ping yanıtı ya da TCP için "aktarım başlıyor". `modsRev`: oyuncuya giden mod listesinin özeti.
    Ok {
        running: bool,
        name: String,
        #[serde(default, rename = "modsRev", skip_serializing_if = "Option::is_none")]
        mods_rev: Option<String>,
        /// Kapağın sürümü; değişince arkadaş yenisini `Cover` akışıyla alır. Kapak yoksa yok.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cover: Option<u64>,
        /// Dünyanın güncel davet kodu (`K7M-2QX`): arkadaş başkasını çağırabilsin.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// Davet geçersiz (token yanlış, dünya silinmiş).
    Denied,
    /// Dünya kapalı (TCP isteğinde).
    Offline,
}

pub async fn write_line<T: Serialize>(
    w: &mut (impl AsyncWrite + Unpin),
    value: &T,
) -> std::io::Result<()> {
    let mut buf = serde_json::to_vec(value).map_err(std::io::Error::other)?;
    buf.push(b'\n');
    w.write_all(&buf).await
}

/// Gövdeyi sonuna kadar okur; `max`'tan büyükse hata.
pub async fn read_body(r: &mut (impl AsyncRead + Unpin), max: usize) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    let n = r.take(max as u64 + 1).read_to_end(&mut buf).await?;
    if n > max {
        return Err(std::io::Error::other(tx!(
            "gövde çok büyük",
            "body too large"
        )));
    }
    Ok(buf)
}

/// `\n`'e kadar okur (bayt bayt; başlıktan sonraki veriyi tüketmemek için).
pub async fn read_line<T: for<'de> Deserialize<'de>>(
    r: &mut (impl AsyncRead + Unpin),
) -> std::io::Result<T> {
    let mut buf = Vec::with_capacity(128);
    loop {
        let b = r.read_u8().await?;
        if b == b'\n' {
            break;
        }
        if buf.len() >= MAX_LINE {
            return Err(std::io::Error::other(tx!(
                "başlık çok uzun",
                "header too long"
            )));
        }
        buf.push(b);
    }
    serde_json::from_slice(&buf).map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn header_roundtrip_keeps_following_bytes() {
        let h = StreamHeader {
            world: "w1".into(),
            token: "t".into(),
            kind: StreamKind::Tcp,
            file: None,
        };
        let mut buf = Vec::new();
        write_line(&mut buf, &h).await.unwrap();
        buf.extend_from_slice(b"\x10\x00MINECRAFT");
        let mut r = buf.as_slice();
        let back: StreamHeader = read_line(&mut r).await.unwrap();
        assert_eq!(back, h);
        assert_eq!(r, b"\x10\x00MINECRAFT");
    }

    #[tokio::test]
    async fn rejects_oversized_and_garbage() {
        let long = vec![b'a'; MAX_LINE + 10];
        assert!(
            read_line::<StreamHeader>(&mut long.as_slice())
                .await
                .is_err()
        );
        assert!(
            read_line::<StreamHeader>(&mut b"{nope}\n".as_slice())
                .await
                .is_err()
        );
        assert!(
            read_line::<StreamHeader>(&mut b"{\"world\":1".as_slice())
                .await
                .is_err()
        );
    }

    #[test]
    fn reply_json_shape() {
        let r = Reply::Ok {
            running: true,
            name: "x".into(),
            mods_rev: None,
            cover: None,
            code: None,
        };
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"status":"ok","running":true,"name":"x"}"#
        );
        assert_eq!(
            serde_json::to_string(&Reply::Denied).unwrap(),
            r#"{"status":"denied"}"#
        );
        // Eski sürümün yanıtı (modsRev yok) okunabilir.
        let old: Reply =
            serde_json::from_str(r#"{"status":"ok","running":false,"name":"y"}"#).unwrap();
        assert!(matches!(
            old,
            Reply::Ok {
                mods_rev: None,
                cover: None,
                code: None,
                ..
            }
        ));
        let new: Reply = serde_json::from_str(
            r#"{"status":"ok","running":true,"name":"y","cover":3,"code":"K7M-2QX"}"#,
        )
        .unwrap();
        assert!(matches!(new, Reply::Ok { cover: Some(3), .. }));
    }

    #[tokio::test]
    async fn body_limit() {
        assert_eq!(read_body(&mut b"abc".as_slice(), 3).await.unwrap(), b"abc");
        assert!(read_body(&mut b"abcd".as_slice(), 3).await.is_err());
    }
}
