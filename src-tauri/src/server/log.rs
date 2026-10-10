/// Sunucu log satırından çıkarılan olaylar.
#[derive(Debug, PartialEq, Eq)]
pub enum LogEvent {
    /// `Done (3.456s)! For help, type "help"` — sunucu bağlantı kabul etmeye hazır.
    Done,
    Joined(String),
    Left(String),
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
    if let Some(name) = msg.strip_suffix(" joined the game") {
        return is_player_name(name).then(|| LogEvent::Joined(name.to_string()));
    }
    if let Some(name) = msg.strip_suffix(" left the game") {
        return is_player_name(name).then(|| LogEvent::Left(name.to_string()));
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
