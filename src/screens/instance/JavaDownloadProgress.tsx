import { formatBytesMb } from "../../lib/format";
import { useAppStore } from "../../store/appStore";
import { Progress } from "../../ui/Progress";

/** `install_java` sırasında gelen `java://progress` olaylarını gösterir. */
export function JavaDownloadProgress() {
  const p = useAppStore((s) => s.javaProgress);
  const value = p?.stage === "download" && p.total ? p.downloaded / p.total : null;
  const text = !p
    ? "Hazırlanıyor…"
    : p.stage === "extract"
      ? `Java ${p.major} açılıyor…`
      : `Java ${p.major} indiriliyor… ${formatBytesMb(p.downloaded)}${p.total ? ` / ${formatBytesMb(p.total)}` : ""} MB`;
  return (
    <>
      <Progress value={value} />
      <p style={{ fontSize: "var(--fs-sm)" }}>{text}</p>
    </>
  );
}
