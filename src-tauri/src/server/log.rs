/// Sunucu log satırından çıkarılan olaylar.
#[derive(Debug, PartialEq, Eq)]
pub enum LogEvent {
    /// `Done (3.456s)! For help, type "help"` — sunucu bağlantı kabul etmeye hazır.
    Done,
    Joined(String),
    Left(String),
    /// Beyaz listede olmadığı için atıldı.
    Rejected(String),
}

/// Minecraft kullanıcı adı: 1–16 harf, rakam veya `_` (sohbet ve `[Server]` satırları elenir).
fn is_player_name(s: &str) -> bool {
    (1..=16).contains(&s.len()) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn parse(line: &str) -> Option<LogEvent> {
    // "[14:02:11] [Server thread/INFO]: mesaj" ya da Paper: "[14:02:11 INFO]: mesaj"
    let msg = &line[line.find("]: ")? + 3..];
    if let Some(rest) = msg.strip_prefix("Done (") {
        return rest.contains(")!").then_some(LogEvent::Done);
    }
    // Sohbet satırı değil, sunucunun kendi kaydı; tüm sürümlerde aynı:
    // "firatmio[/192.168.0.195:8969] logged in with entity id 1 at (-8.5, 66.0, 11.5)"
    if msg.contains("] logged in with entity id ")
        && let Some((name, _)) = msg.split_once('[')
    {
        return is_player_name(name).then(|| LogEvent::Joined(name.to_string()));
    }
    // "Ali lost connection: Disconnected" (beyaz liste reddi ayrıca "Disconnecting …" ile gelir)
    if let Some((name, reason)) = msg.split_once(" lost connection: ") {
        let lower = reason.to_ascii_lowercase();
        if lower.contains("white-listed") || lower.contains("whitelisted") {
            return None;
        }
        return is_player_name(name).then(|| LogEvent::Left(name.to_string()));
    }
    // 26.x sistem mesajlarını "System chat: " önekiyle yazıyor.
    let announce = msg.strip_prefix("System chat: ").unwrap_or(msg);
    if let Some(name) = announce.strip_suffix(" joined the game") {
        return is_player_name(name).then(|| LogEvent::Joined(name.to_string()));
    }
    if let Some(name) = announce.strip_suffix(" left the game") {
        return is_player_name(name).then(|| LogEvent::Left(name.to_string()));
    }
    // "Disconnecting Ali (/192.168.0.5:51234): You are not white-listed on this server!"
    if let Some(rest) = msg.strip_prefix("Disconnecting ") {
        let lower = rest.to_ascii_lowercase();
        if lower.contains("not white-listed") || lower.contains("not whitelisted") {
            let name = rest.split([' ', '(']).next().unwrap_or("");
            return is_player_name(name).then(|| LogEvent::Rejected(name.to_string()));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_done_line() {
        assert_eq!(
            parse(r#"[14:02:11] [Server thread/INFO]: Done (3.456s)! For help, type "help""#),
            Some(LogEvent::Done)
        );
        assert_eq!(
            parse("[14:02:11 INFO]: Done (12.03s)! For help, type \"help\""),
            Some(LogEvent::Done)
        );
    }

    #[test]
    fn detects_joins_and_leaves() {
        assert_eq!(
            parse("[16:21:02] [Server thread/INFO]: Ali_2 joined the game"),
            Some(LogEvent::Joined("Ali_2".into()))
        );
        assert_eq!(
            parse("[16:30:00 INFO]: Ali left the game"),
            Some(LogEvent::Left("Ali".into()))
        );
    }

    /// 26.3'ün gerçek log satırları (kullanıcının sunucusundan).
    #[test]
    fn detects_26x_system_chat_and_login_lines() {
        assert_eq!(
            parse("[21:51:29] [Server thread/INFO]: System chat: firatmio joined the game"),
            Some(LogEvent::Joined("firatmio".into()))
        );
        assert_eq!(
            parse(
                "[21:51:29] [Server thread/INFO]: firatmio[/192.168.0.195:8969] logged in with entity id 1 at (-8.5, 66.0, 11.5)"
            ),
            Some(LogEvent::Joined("firatmio".into()))
        );
        assert_eq!(
            parse("[21:59:02] [Server thread/INFO]: System chat: firatmio left the game"),
            Some(LogEvent::Left("firatmio".into()))
        );
        assert_eq!(
            parse("[21:59:02] [Server thread/INFO]: firatmio lost connection: Disconnected"),
            Some(LogEvent::Left("firatmio".into()))
        );
        // Oyuncu sohbetinde aynı metni yazmak giriş sayılmaz.
        assert_eq!(
            parse("[21:59:02] [Server thread/INFO]: <Ali> System chat: Veli joined the game"),
            None
        );
    }

    #[test]
    fn detects_whitelist_rejections() {
        assert_eq!(
            parse(
                "[18:18:04] [Server thread/INFO]: Disconnecting firatmio (/192.168.0.195:24351): You are not white-listed on this server!"
            ),
            Some(LogEvent::Rejected("firatmio".into()))
        );
        assert_eq!(
            parse(
                "[18:18:04 INFO]: Disconnecting Ali (/127.0.0.1:5000): You are not whitelisted on this server!"
            ),
            Some(LogEvent::Rejected("Ali".into()))
        );
        assert_eq!(
            parse(
                "[18:18:04] [Server thread/INFO]: firatmio (/192.168.0.195:24351) lost connection: You are not white-listed on this server!"
            ),
            None
        );
    }

    #[test]
    fn ignores_chat_and_other_lines() {
        assert_eq!(
            parse("[14:02:11] [Server thread/INFO]: Preparing spawn area: 83%"),
            None
        );
        assert_eq!(
            parse("[14:02:11] [Server thread/INFO]: <Ali> Done (lol)"),
            None
        );
        assert_eq!(
            parse("[14:02:11] [Server thread/INFO]: <Ali> Veli joined the game"),
            None
        );
        assert_eq!(
            parse("[14:02:11] [Server thread/INFO]: [Server] Veli joined the game"),
            None
        );
        assert_eq!(parse("Done (1s)!"), None);
    }
}
