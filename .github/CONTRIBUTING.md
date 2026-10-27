# Contributing · Katkı

Thanks for wanting to help! Cubby is **source-available, not open source** (see [LICENSE](../LICENSE)),
so the most useful contributions are:

- **Bug reports** with steps to reproduce: [open one](https://github.com/firatmio/cubby/issues/new/choose).
- **Ideas** about playing with friends: what you wanted to do and where it got in the way.
- **Translations and wording fixes** for Turkish and English.

Pull requests are welcome for small fixes. For anything larger, please open an issue first so we can
agree on the approach. By opening a pull request you agree to section 3 of the LICENSE.

## Before you send a change

```bash
cd src-tauri && cargo fmt --check && cargo clippy --all-targets && cargo test
bun run build
cd web && bun test && bun run typecheck   # if web/ changed
```

Or all at once in Docker, exactly like CI: `bun run ci`.

- Every new piece of UI text goes into both `src/i18n/tr.ts` and `src/i18n/en.ts`; Rust messages use
  `tx!("Türkçe", "English")`.
- Write UI text the way you'd talk to a friend: short, plain, no jargon.
- Never commit invite codes, real player names or anything from your own `.minecraft`.

---

Yardım etmek istediğin için teşekkürler! Cubby **açık kaynak değil, kaynağı görünür** ([LICENSE](../LICENSE)).
En faydalı katkılar: tekrarlanma adımlarıyla **hata bildirimleri**, arkadaşlarla oynarken takıldığın yerlerle
ilgili **fikirler**, Türkçe ve İngilizce **metin düzeltmeleri**. Küçük düzeltmeler için pull request
açabilirsin; büyük değişikliklerden önce lütfen issue aç. Pull request açarak LICENSE'ın 3. maddesini
kabul etmiş olursun. Yeni her metin iki dilde de olmalı; davet kodu, gerçek oyuncu adı ya da kendi
`.minecraft` klasöründen bir şey commit'leme.
