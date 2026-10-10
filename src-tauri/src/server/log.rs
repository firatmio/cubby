/// Sunucu log satırından çıkarılan olaylar. M4: oyuncu giriş/çıkışı da buraya.
#[derive(Debug, PartialEq, Eq)]
pub enum LogEvent {
    /// `Done (3.456s)! For help, type "help"` — sunucu bağlantı kabul etmeye hazır.
    Done,
}

pub fn parse(line: &str) -> Option<LogEvent> {
    let rest = &line[line.find("]: Done (")? + "]: Done (".len()..];
    rest.contains(")!").then_some(LogEvent::Done)
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
    fn ignores_chat_and_other_lines() {
        assert_eq!(
            parse("[14:02:11] [Server thread/INFO]: Preparing spawn area: 83%"),
            None
        );
        assert_eq!(
            parse("[14:02:11] [Server thread/INFO]: <Ali> Done (lol)"),
            None
        );
        assert_eq!(parse("Done (1s)!"), None);
    }
}
