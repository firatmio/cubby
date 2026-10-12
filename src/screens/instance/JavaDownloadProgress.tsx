import { formatBytesMb } from "../../lib/format";
import { useT } from "../../i18n";
import { useAppStore } from "../../store/appStore";
import { Progress } from "../../ui/Progress";

/** `install_java` sırasında gelen `java://progress` olaylarını gösterir. */
export function JavaDownloadProgress() {
  const p = useAppStore((s) => s.javaProgress);
  const t = useT();
  const value = p?.stage === "download" && p.total ? p.downloaded / p.total : null;
  const text = !p
    ? t.common.preparing
    : p.stage === "extract"
      ? t.start.javaExtracting(p.major)
      : t.start.javaDownloading(p.major, formatBytesMb(p.downloaded), p.total ? formatBytesMb(p.total) : null);
  return (
    <>
      <Progress value={value} />
      <p style={{ fontSize: "var(--fs-sm)" }}>{text}</p>
    </>
  );
}
