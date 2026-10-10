//! `server.properties` okuma/yazma. Satır sırası ve yorumlar korunur; Java Properties kaçışları
//! (`\:`, `\=`, `\\`, `\uXXXX`) çözülür ve yazarken uygulanır.

use std::collections::BTreeMap;
use std::path::Path;

use crate::error::AppResult;

pub const FILE: &str = "server.properties";

#[derive(Debug, Clone)]
enum Line {
    /// Yorum veya boş satır, olduğu gibi.
    Raw(String),
    Entry {
        key: String,
        value: String,
    },
}

#[derive(Debug, Clone, Default)]
pub struct Properties {
    lines: Vec<Line>,
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                let Ok(unit) = u16::from_str_radix(&hex, 16) else {
                    out.push_str("\\u");
                    out.push_str(&hex);
                    continue;
                };
                // Emoji gibi karakterler iki birimlik (surrogate) çift olarak yazılır: "🎮".
                let mut units = vec![unit];
                if (0xD800..0xDC00).contains(&unit) {
                    let rest = chars.as_str();
                    if let Some(low) = rest
                        .strip_prefix("\\u")
                        .and_then(|r| r.get(..4))
                        .and_then(|h| u16::from_str_radix(h, 16).ok())
                        .filter(|l| (0xDC00..0xE000).contains(l))
                    {
                        units.push(low);
                        chars = rest[6..].chars();
                    }
                }
                out.extend(char::decode_utf16(units).map(|r| r.unwrap_or('\u{FFFD}')));
            }
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some(other) => out.push(other),
            None => {}
        }
    }
    out
}

fn escape(s: &str, is_key: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for (i, c) in s.chars().enumerate() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            ':' | '=' => {
                out.push('\\');
                out.push(c);
            }
            ' ' if is_key || i == 0 => out.push_str("\\ "),
            '#' | '!' if i == 0 => {
                out.push('\\');
                out.push(c);
            }
            c if (c as u32) < 0x20 || (c as u32) > 0x7e => {
                // ASCII dışı: eski (ISO-8859-1) ve yeni (UTF-8) okuyucular aynı şekilde anlasın.
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
            c => out.push(c),
        }
    }
    out
}

/// İlk kaçışsız `=` ya da `:` anahtarı değerden ayırır.
fn split_entry(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim_start();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
        return None;
    }
    let mut escaped = false;
    for (i, c) in trimmed.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match c {
            '\\' => escaped = true,
            '=' | ':' => {
                let key = unescape(trimmed[..i].trim_end());
                let value = unescape(trimmed[i + 1..].trim_start());
                return Some((key, value));
            }
            _ => {}
        }
    }
    Some((unescape(trimmed.trim_end()), String::new()))
}

impl Properties {
    pub fn parse(text: &str) -> Self {
        let lines = text
            .lines()
            .map(|l| match split_entry(l) {
                Some((key, value)) => Line::Entry { key, value },
                None => Line::Raw(l.to_string()),
            })
            .collect();
        Self { lines }
    }

    /// Dosya yoksa boş döner (ilk açılıştan önce).
    pub fn load(server_dir: &Path) -> AppResult<Self> {
        match std::fs::read_to_string(server_dir.join(FILE)) {
            Ok(t) => Ok(Self::parse(&t)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self, server_dir: &Path) -> AppResult<()> {
        std::fs::create_dir_all(server_dir)?;
        let tmp = server_dir.join(format!("{FILE}.tmp"));
        std::fs::write(&tmp, self.to_text())?;
        std::fs::rename(tmp, server_dir.join(FILE))?;
        Ok(())
    }

    pub fn to_text(&self) -> String {
        let mut out = String::new();
        for line in &self.lines {
            match line {
                Line::Raw(s) => out.push_str(s),
                Line::Entry { key, value } => {
                    out.push_str(&escape(key, true));
                    out.push('=');
                    out.push_str(&escape(value, false));
                }
            }
            out.push('\n');
        }
        out
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.lines.iter().rev().find_map(|l| match l {
            Line::Entry { key: k, value } if k == key => Some(value.as_str()),
            _ => None,
        })
    }

    pub fn get_bool(&self, key: &str) -> Option<bool> {
        self.get(key).map(|v| v.trim().eq_ignore_ascii_case("true"))
    }

    /// Var olan satırı yerinde günceller, yoksa sona ekler.
    pub fn set(&mut self, key: &str, value: impl Into<String>) {
        let value = value.into();
        for line in self.lines.iter_mut().rev() {
            if let Line::Entry { key: k, value: v } = line
                && k == key
            {
                *v = value;
                return;
            }
        }
        self.lines.push(Line::Entry {
            key: key.to_string(),
            value,
        });
    }

    pub fn to_map(&self) -> BTreeMap<String, String> {
        self.lines
            .iter()
            .filter_map(|l| match l {
                Line::Entry { key, value } => Some((key.clone(), value.clone())),
                Line::Raw(_) => None,
            })
            .collect()
    }

    pub fn exists_on_disk(server_dir: &Path) -> bool {
        server_dir.join(FILE).is_file()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "#Minecraft server properties\n#Sat Oct 10 18:16:47 GMT+03:00 2026\nlevel-type=minecraft\\:normal\nmotd=A Minecraft Server\nwhite-list=true\nlevel-seed=\n";

    #[test]
    fn reads_escapes_and_values() {
        let p = Properties::parse(SAMPLE);
        assert_eq!(p.get("level-type"), Some("minecraft:normal"));
        assert_eq!(p.get("motd"), Some("A Minecraft Server"));
        assert_eq!(p.get("level-seed"), Some(""));
        assert_eq!(p.get_bool("white-list"), Some(true));
        assert_eq!(p.get("yok"), None);
    }

    #[test]
    fn keeps_comments_order_and_roundtrips() {
        let mut p = Properties::parse(SAMPLE);
        p.set("white-list", "false");
        p.set("max-players", "8");
        let text = p.to_text();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "#Minecraft server properties");
        assert_eq!(lines[2], "level-type=minecraft\\:normal");
        assert_eq!(lines[4], "white-list=false");
        assert_eq!(lines.last(), Some(&"max-players=8"));
        assert_eq!(
            Properties::parse(&text).get("level-type"),
            Some("minecraft:normal")
        );
    }

    #[test]
    fn turkish_motd_roundtrip() {
        let mut p = Properties::default();
        p.set("motd", "Kardeşlerle şöğüş ğİı 🎮");
        let text = p.to_text();
        assert!(text.is_ascii(), "{text}");
        assert!(text.contains("\\u015f"));
        assert_eq!(
            Properties::parse(&text).get("motd"),
            Some("Kardeşlerle şöğüş ğİı 🎮")
        );
    }

    #[test]
    fn parses_unusual_separators() {
        let p = Properties::parse("a: b\nc = d\ne\nkey\\=x=y\n");
        assert_eq!(p.get("a"), Some("b"));
        assert_eq!(p.get("c"), Some("d"));
        assert_eq!(p.get("e"), Some(""));
        assert_eq!(p.get("key=x"), Some("y"));
    }
}
