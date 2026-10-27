//! Davetle gelen Minecraft bağlantısının ilk iki paketini (el sıkışma + Login Start) okur: oyuncunun
//! adı sunucuya gitmeden öğrenilir. Bu aşamada sıkıştırma ve şifreleme yoktur. Okunan baytlar
//! sunucuya aynen iletilir; giriş değilse (sunucu listesi pingi, eski ping, bozuk veri) olduğu gibi
//! geçer, sunucu kendisi yanıtlar ya da reddeder.

use tokio::io::{AsyncRead, AsyncReadExt};

/// Bir paketin en büyük uzunluğu (el sıkışma ve Login Start küçüktür).
pub const MAX_PACKET: usize = 2048;

/// Okunanlar: sunucuya iletilecek ham baytlar ve (girişse) oyuncunun adı.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Login {
    pub name: Option<String>,
    pub consumed: Vec<u8>,
}

/// İlk iki paketi okur. Giriş değilse `name` boş döner ve okunan kadar bayt iletilir.
pub async fn read_login<R: AsyncRead + Unpin>(r: &mut R) -> std::io::Result<Login> {
    let mut out = Login::default();
    let Some(handshake) = read_frame(r, &mut out.consumed).await? else {
        return Ok(out);
    };
    if !matches!(parse_handshake(&handshake), Some(2 | 3)) {
        return Ok(out);
    }
    if let Some(login) = read_frame(r, &mut out.consumed).await? {
        out.name = parse_login_start(&login);
    }
    Ok(out)
}

/// Uzunluk önekli bir paketin gövdesi. Eski ping (0xFE) ya da sınırı aşan uzunlukta `None`; okunan
/// her bayt `raw`'a eklenir.
async fn read_frame<R: AsyncRead + Unpin>(
    r: &mut R,
    raw: &mut Vec<u8>,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut len: u32 = 0;
    for i in 0..5 {
        let b = r.read_u8().await?;
        raw.push(b);
        if i == 0 && b == 0xFE {
            return Ok(None);
        }
        len |= u32::from(b & 0x7F) << (7 * i);
        if b & 0x80 == 0 {
            if len == 0 || len as usize > MAX_PACKET {
                return Ok(None);
            }
            let mut body = vec![0u8; len as usize];
            r.read_exact(&mut body).await?;
            raw.extend_from_slice(&body);
            return Ok(Some(body));
        }
    }
    Ok(None)
}

/// VarInt ve kaç bayt sürdüğü.
pub fn read_varint(buf: &[u8]) -> Option<(i32, usize)> {
    let mut value: u32 = 0;
    for (i, &b) in buf.iter().enumerate().take(5) {
        value |= u32::from(b & 0x7F) << (7 * i);
        if b & 0x80 == 0 {
            return Some((value as i32, i + 1));
        }
    }
    None
}

pub fn write_varint(out: &mut Vec<u8>, value: i32) {
    let mut v = value as u32;
    loop {
        let byte = (v & 0x7F) as u8;
        v >>= 7;
        if v == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn read_string(buf: &[u8], max_chars: usize) -> Option<(String, usize)> {
    let (len, n) = read_varint(buf)?;
    let len = usize::try_from(len).ok()?;
    if len > max_chars * 4 {
        return None;
    }
    let s = std::str::from_utf8(buf.get(n..n + len)?).ok()?;
    (s.chars().count() <= max_chars).then(|| (s.to_string(), n + len))
}

/// El sıkışmanın "sonraki durum"u: 1 sunucu listesi, 2 giriş, 3 aktarım.
pub fn parse_handshake(body: &[u8]) -> Option<i32> {
    let (id, mut i) = read_varint(body)?;
    if id != 0 {
        return None;
    }
    let (_protocol, n) = read_varint(&body[i..])?;
    i += n;
    let (_address, n) = read_string(&body[i..], 255)?;
    i += n + 2;
    let (next, _) = read_varint(body.get(i..)?)?;
    Some(next)
}

/// Login Start'taki oyuncu adı.
pub fn parse_login_start(body: &[u8]) -> Option<String> {
    let (id, i) = read_varint(body)?;
    if id != 0 {
        return None;
    }
    let (name, _) = read_string(&body[i..], 16)?;
    (!name.is_empty()).then_some(name)
}

/// Girişte oyuncuyu bir mesajla geri çeviren paket (Login Disconnect, JSON metin).
pub fn disconnect_packet(message: &str) -> Vec<u8> {
    let json = serde_json::json!({ "text": message }).to_string();
    let mut body = Vec::new();
    write_varint(&mut body, 0);
    write_varint(&mut body, json.len() as i32);
    body.extend_from_slice(json.as_bytes());
    let mut packet = Vec::new();
    write_varint(&mut packet, body.len() as i32);
    packet.extend_from_slice(&body);
    packet
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(body: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        write_varint(&mut out, body.len() as i32);
        out.extend_from_slice(body);
        out
    }

    fn string(s: &str) -> Vec<u8> {
        let mut out = Vec::new();
        write_varint(&mut out, s.len() as i32);
        out.extend_from_slice(s.as_bytes());
        out
    }

    fn handshake(protocol: i32, next: i32) -> Vec<u8> {
        let mut b = vec![0x00];
        write_varint(&mut b, protocol);
        b.extend(string("127.0.0.1"));
        b.extend_from_slice(&25600u16.to_be_bytes());
        write_varint(&mut b, next);
        frame(&b)
    }

    fn login_start(name: &str) -> Vec<u8> {
        let mut b = vec![0x00];
        b.extend(string(name));
        b.extend_from_slice(&[0x11; 16]); // UUID (1.20.2+)
        frame(&b)
    }

    #[test]
    fn varints_round_trip() {
        for v in [0, 1, 127, 128, 255, 25565, 772, 2_097_151, i32::MAX, -1] {
            let mut b = Vec::new();
            write_varint(&mut b, v);
            assert_eq!(read_varint(&b), Some((v, b.len())), "{v}");
        }
        assert_eq!(read_varint(&[0x80, 0x80]), None);
    }

    #[tokio::test]
    async fn reads_the_name_and_keeps_every_byte() {
        let mut input = handshake(772, 2);
        input.extend(login_start("Ali_42"));
        input.extend_from_slice(b"sonrasi");
        let mut r = &input[..];
        let login = read_login(&mut r).await.unwrap();
        assert_eq!(login.name.as_deref(), Some("Ali_42"));
        assert_eq!(
            login.consumed,
            [handshake(772, 2), login_start("Ali_42")].concat()
        );
        assert_eq!(r, b"sonrasi", "fazlası okunmaz");
    }

    #[tokio::test]
    async fn status_ping_and_garbage_pass_through() {
        // Sunucu listesi pingi: yalnız el sıkışma okunur, ad yok.
        let mut input = handshake(772, 1);
        input.extend(frame(&[0x00]));
        let mut r = &input[..];
        let login = read_login(&mut r).await.unwrap();
        assert_eq!(login.name, None);
        assert_eq!(login.consumed, handshake(772, 1));

        // Eski ping (0xFE) ilk baytta durur.
        let mut r: &[u8] = &[0xFE, 0x01, 0xFA];
        let login = read_login(&mut r).await.unwrap();
        assert_eq!((login.name, login.consumed), (None, vec![0xFE]));

        // Sınırı aşan uzunluk: okunmaz, olduğu gibi geçer.
        let mut big = Vec::new();
        write_varint(&mut big, (MAX_PACKET + 1) as i32);
        let mut r = &big[..];
        let login = read_login(&mut r).await.unwrap();
        assert_eq!((login.name, login.consumed), (None, big.clone()));

        // Login Start yerine başka paket: ad yok ama baytlar kaybolmaz.
        let mut input = handshake(772, 2);
        input.extend(frame(&[0x05, 0x01]));
        let mut r = &input[..];
        let login = read_login(&mut r).await.unwrap();
        assert_eq!(login.name, None);
        assert_eq!(login.consumed, input);
    }

    #[test]
    fn rejects_bad_names() {
        let mut long = vec![0x00];
        long.extend(string("cok_uzun_bir_oyuncu_adi"));
        assert_eq!(parse_login_start(&long), None);
        assert_eq!(parse_login_start(&[0x00, 0x00]), None);
        assert_eq!(parse_handshake(&[0x01]), None);
    }

    #[test]
    fn disconnect_packet_is_framed_json() {
        let p = disconnect_packet("Bu ad başka bir \"arkadaşına\" bağlı");
        let (len, n) = read_varint(&p).unwrap();
        assert_eq!(len as usize, p.len() - n);
        let body = &p[n..];
        assert_eq!(body[0], 0x00);
        let (json, _) = read_string(&body[1..], 1000).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["text"], "Bu ad başka bir \"arkadaşına\" bağlı");
    }
}
