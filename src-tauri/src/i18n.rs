//! Arka uç metinlerinin dili (hata mesajları, konsola yazılan sistem satırları, tepsi menüsü).
//! Arayüz kendi sözlüğünü kullanır (`src/i18n`); iki taraf da `settings.language`'dan beslenir.
//!
//! Metinler çağrıldıkları yerde iki dilde yazılır: `tx!("Türkçe {x}", "English {x}")`.

#[cfg(not(test))]
use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Tr,
    En,
}

#[cfg(not(test))]
static LANG: AtomicU8 = AtomicU8::new(0);

// Testler paralel koşuyor: biri dili değiştirince ötekinin beklediği metin bozulmasın.
#[cfg(test)]
thread_local! {
    static LANG: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

fn load() -> u8 {
    #[cfg(not(test))]
    return LANG.load(Ordering::Relaxed);
    #[cfg(test)]
    return LANG.with(|l| l.get());
}

pub fn lang() -> Lang {
    match load() {
        1 => Lang::En,
        _ => Lang::Tr,
    }
}

pub fn set_lang(l: Lang) {
    #[cfg(not(test))]
    LANG.store(l as u8, Ordering::Relaxed);
    #[cfg(test)]
    LANG.with(|c| c.set(l as u8));
}

pub fn is_en() -> bool {
    lang() == Lang::En
}

/// İşletim sisteminin dil etiketinden (`tr-TR`, `en-GB`, `de-DE` …): Türkçe ise Türkçe, değilse İngilizce.
pub fn from_locale(tag: Option<&str>) -> Lang {
    match tag {
        Some(t) if t.to_ascii_lowercase().starts_with("tr") => Lang::Tr,
        _ => Lang::En,
    }
}

/// Ayar (`"tr"` / `"en"`), yoksa işletim sisteminin dili.
pub fn effective(setting: Option<&str>) -> Lang {
    match setting {
        Some("tr") => Lang::Tr,
        Some("en") => Lang::En,
        _ => from_locale(sys_locale::get_locale().as_deref()),
    }
}

/// Etkin dile göre metin: `tx!("Merhaba {ad}", "Hello {ad}")`. Biçim değişkenleri `format!` gibidir.
#[macro_export]
macro_rules! tx {
    ($tr:literal, $en:literal $(,)?) => {
        if $crate::i18n::is_en() { format!($en) } else { format!($tr) }
    };
    ($tr:literal, $en:literal, $($arg:tt)+) => {
        if $crate::i18n::is_en() { format!($en, $($arg)+) } else { format!($tr, $($arg)+) }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_language() {
        assert_eq!(from_locale(Some("tr-TR")), Lang::Tr);
        assert_eq!(from_locale(Some("TR")), Lang::Tr);
        assert_eq!(from_locale(Some("en-GB")), Lang::En);
        assert_eq!(from_locale(Some("de-DE")), Lang::En);
        assert_eq!(from_locale(None), Lang::En);
        assert_eq!(effective(Some("tr")), Lang::Tr);
        assert_eq!(effective(Some("en")), Lang::En);
    }

    #[test]
    fn translates_with_args() {
        let n = 3;
        set_lang(Lang::En);
        assert_eq!(tx!("{n} oyuncu", "{n} players"), "3 players");
        assert_eq!(tx!("Kapalı", "Off"), "Off");
        set_lang(Lang::Tr);
        assert_eq!(tx!("{} oyuncu", "{} players", n), "3 oyuncu");
    }
}
