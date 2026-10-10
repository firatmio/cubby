import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { McButton } from "../../components/McButton";
import { McInput } from "../../components/McInput";
import { api, errorMessage, type LogLine, type ServerStatus } from "../../lib/api";
import styles from "./ConsoleTab.module.css";

type Props = {
  id: string;
  status: ServerStatus;
  logs: LogLine[];
};

/** Alttan bu kadar piksel içindeyse yeni satırlarda otomatik kaydırılır. */
const STICK_THRESHOLD = 16;

function lineClass(l: LogLine): string {
  if (l.stream === "system") return styles.system;
  if (l.stream === "stderr" || l.line.includes("ERROR]")) return styles.error;
  if (l.line.includes("WARN]")) return styles.warn;
  return "";
}

export function ConsoleTab({ id, status, logs }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canSend = status === "running" || status === "starting";

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const onScroll = () => {
    const el = logRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Sunucu konsolunda komutlar "/" olmadan yazılır.
    const cmd = command.trim().replace(/^\//, "");
    if (!cmd) return;
    const h = history.current;
    if (h[h.length - 1] !== cmd) h.push(cmd);
    historyIndex.current = -1;
    setCommand("");
    setError(null);
    stick.current = true;
    try {
      await api.sendCommand(id, cmd);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const h = history.current;
    if (e.key === "ArrowUp" && h.length > 0) {
      e.preventDefault();
      const i = historyIndex.current === -1 ? h.length - 1 : Math.max(0, historyIndex.current - 1);
      historyIndex.current = i;
      setCommand(h[i]);
    } else if (e.key === "ArrowDown" && historyIndex.current !== -1) {
      e.preventDefault();
      const i = historyIndex.current + 1;
      historyIndex.current = i >= h.length ? -1 : i;
      setCommand(i >= h.length ? "" : h[i]);
    }
  };

  return (
    <div className={styles.console}>
      <div ref={logRef} className={styles.log} onScroll={onScroll}>
        {logs.length === 0 ? (
          <p className={styles.empty}>
            {status === "stopped" ? "Sunucu kapalı. Başlat'a bas, loglar burada akacak." : "Bekleniyor…"}
          </p>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={`${styles.line} ${lineClass(l)}`}>
              {l.line}
            </div>
          ))
        )}
      </div>
      {error && <div className={styles.sendError}>{error}</div>}
      <form className={styles.inputRow} onSubmit={submit}>
        <McInput
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!canSend}
          spellCheck={false}
          autoComplete="off"
          placeholder={canSend ? "Komut yaz… (ör. say merhaba, list, op <oyuncu>)" : "Sunucu kapalıyken komut gönderilemez"}
        />
        <McButton type="submit" disabled={!canSend || !command.trim()}>
          Gönder
        </McButton>
      </form>
    </div>
  );
}
