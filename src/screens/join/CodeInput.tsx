import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { CODE_LEN, cleanCode, extractCode } from "../../lib/inviteCode";
import { useT } from "../../i18n";
import { Cells, codeCellStyles } from "../../ui/CodeCells";
import styles from "./JoinDialog.module.css";

type Props = {
  /** Dışarıdan gelen kod (ör. davet linkiyle açılış); tiresiz. */
  initial: string;
  /** Her değişimde iki kutunun birleşimi (tamamlanmamış olabilir). */
  onChange: (code: string) => void;
  /** 6 karakter tamamlanınca (yazarak ya da yapıştırarak). */
  onComplete: (code: string) => void;
  onEnter: () => void;
  disabled?: boolean;
};

const HALF = CODE_LEN / 2;

/**
 * Üç hücreli bir yarı: görünen hücreler, üstünde görünmez bir input (yazma, yapıştırma ve
 * erişilebilirlik onda). Odaktayken sıradaki hücre vurgulanır ve imleç orada yanıp söner.
 */
function Half({ value, focused, children }: { value: string; focused: boolean; children: ReactNode }) {
  return (
    <div className={styles.codeHalf}>
      <Cells
        value={value}
        length={HALF}
        active={focused ? Math.min(value.length, HALF - 1) : null}
        caret={focused && value.length < HALF ? value.length : null}
      />
      {children}
    </div>
  );
}

/**
 * İki üçlü kutu (`K7M` – `2QX`): yalnız koddaki karakterler kabul edilir, ilk kutu dolunca
 * ikinciye geçilir, boş ikinci kutuda geri silince ilkine dönülür. Link ya da tireli kod
 * yapıştırılırsa kod ayıklanıp iki kutuya dağıtılır.
 */
export function CodeInput({ initial, onChange, onComplete, onEnter, disabled }: Props) {
  const t = useT().join;
  const first = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState<"left" | "right" | null>(null);
  const [[left, right], setHalves] = useState<[string, string]>(() => [
    initial.slice(0, HALF),
    initial.slice(HALF, CODE_LEN),
  ]);

  useEffect(() => {
    (initial.length >= HALF ? second : first).current?.focus();
    // Yalnız açılışta; sonraki odak geçişleri yazarken yapılır.
  }, []);

  const update = (l: string, r: string) => {
    setHalves([l, r]);
    const code = l + r;
    onChange(code);
    if (l.length === HALF && r.length === HALF) onComplete(code);
  };

  /** Bir kerede altı karakter (yapıştırma, otomatik doldurma, hızlı yazma). */
  const fill = (code: string) => {
    const l = code.slice(0, HALF);
    const r = code.slice(HALF, CODE_LEN);
    update(l, r);
    (l.length === HALF ? second : first).current?.focus();
  };

  const typeLeft = (raw: string) => {
    const typed = cleanCode(raw);
    if (typed.length > HALF) return fill(typed);
    update(typed, right);
    if (typed.length === HALF) second.current?.focus();
  };

  const typeRight = (raw: string) => update(left, cleanCode(raw).slice(0, HALF));

  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const code = extractCode(text) ?? cleanCode(text).slice(0, CODE_LEN);
    if (!code) return;
    e.preventDefault();
    fill(code);
  };

  const keyLeft = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") return onEnter();
    const el = e.currentTarget;
    if (e.key === "ArrowRight" && el.selectionStart === left.length) {
      e.preventDefault();
      second.current?.focus();
    }
  };

  const keyRight = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") return onEnter();
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    if ((e.key === "Backspace" && right === "") || (e.key === "ArrowLeft" && atStart)) {
      e.preventDefault();
      if (e.key === "Backspace") update(left.slice(0, -1), right);
      first.current?.focus();
    }
  };

  /** Hücreler sırayla dolar: imleç hep sonda kalsın (ortadan düzenleme yok). */
  const toEnd = (el: HTMLInputElement) => el.setSelectionRange(el.value.length, el.value.length);

  const common = {
    className: styles.codeBox,
    // Taşma yakalansın diye biraz fazla: altı karakter tek kutuya yazılırsa ikiye dağıtılır.
    maxLength: CODE_LEN,
    disabled,
    autoComplete: "off",
    autoCapitalize: "characters",
    spellCheck: false,
    onPaste: paste,
    onBlur: () => setFocused(null),
    onClick: (e: React.MouseEvent<HTMLInputElement>) => toEnd(e.currentTarget),
  } as const;

  return (
    <div className={[codeCellStyles.code, styles.codeInput].join(" ")} role="group" aria-label={t.codeLabel}>
      <Half value={left} focused={focused === "left"}>
        <input
          {...common}
          ref={first}
          value={left}
          aria-label={t.codeFirst}
          onChange={(e) => typeLeft(e.target.value)}
          onKeyDown={keyLeft}
          onFocus={(e) => {
            setFocused("left");
            toEnd(e.currentTarget);
          }}
        />
      </Half>
      <span className={codeCellStyles.dash} aria-hidden />
      <Half value={right} focused={focused === "right"}>
        <input
          {...common}
          ref={second}
          value={right}
          aria-label={t.codeLast}
          onChange={(e) => typeRight(e.target.value)}
          onKeyDown={keyRight}
          onFocus={(e) => {
            // İlk kutu eksikken ikinciye tıklanırsa yazı ilk kutudan devam etsin. Durum değil DOM
            // okunur: ilk kutu dolar dolmaz yapılan geçişte durum henüz güncellenmemiş olur.
            if ((first.current?.value.length ?? 0) < HALF) return first.current?.focus();
            setFocused("right");
            toEnd(e.currentTarget);
          }}
        />
      </Half>
    </div>
  );
}
