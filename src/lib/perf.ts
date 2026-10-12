import { create } from "zustand";

/**
 * Animasyon seviyesi — uygulamanın her yerinde ortak.
 * - `full`: esneyen geçişler, goo haplar, bulanık cam yüzeyler.
 * - `simple`: düz kaymalar, bulanıklık yok (güçsüz ekran kartı ya da oyun açıkken kare düşüyorsa).
 * - `off`: yalnız yumuşak belirme (Windows'ta "animasyon efektleri" kapalı).
 */
export type MotionLevel = "full" | "simple" | "off";
/** Kullanıcı ayarı: otomatik ya da elle. */
export type MotionSetting = "auto" | "full" | "simple";

interface MotionStore {
  setting: MotionSetting;
  /** Bilgisayardan ve ölçülen karelerden çıkan seviye. */
  detected: MotionLevel;
  level: MotionLevel;
  setSetting: (s: MotionSetting) => void;
  /** Çalışırken kare düşerse (yalnız otomatikte etkili). */
  downgrade: () => void;
}

const reducedQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

/** Yazılımla çizen (ekran kartı olmayan) WebView'lar. */
function softwareRenderer(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return true;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|basic render|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

function detect(): MotionLevel {
  if (reducedQuery?.matches) return "off";
  // Geliştirirken sade modu denemek için: localStorage.setItem("cubby.motion", "simple")
  if (import.meta.env.DEV) {
    try {
      const forced = localStorage.getItem("cubby.motion");
      if (forced === "full" || forced === "simple" || forced === "off") return forced;
    } catch {
      /* depolama kapalı olabilir */
    }
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2) return "simple";
  if (softwareRenderer()) return "simple";
  return "full";
}

function resolve(setting: MotionSetting, detected: MotionLevel): MotionLevel {
  // Windows animasyonları kapalıysa elle "Tam" seçilse bile yalnız belirme kalır.
  if (detected === "off") return "off";
  return setting === "auto" ? detected : setting;
}

function apply(level: MotionLevel) {
  document.documentElement.dataset.motion = level;
}

const initial = typeof window !== "undefined" ? detect() : "full";

export const useMotion = create<MotionStore>((set, get) => ({
  setting: "auto",
  detected: initial,
  level: initial,
  setSetting: (setting) => {
    const level = resolve(setting, get().detected);
    apply(level);
    set({ setting, level });
  },
  downgrade: () => {
    const { detected, setting } = get();
    if (detected !== "full") return;
    const level = resolve(setting, "simple");
    apply(level);
    set({ detected: "simple", level });
  },
}));

if (typeof window !== "undefined") {
  apply(initial);
  // Windows'ta animasyon ayarı uygulama açıkken değişirse.
  reducedQuery?.addEventListener("change", () => {
    const detected = detect();
    const level = resolve(useMotion.getState().setting, detected);
    apply(level);
    useMotion.setState({ detected, level });
  });
}

export function useMotionLevel(): MotionLevel {
  return useMotion((s) => s.level);
}

export function motionLevel(): MotionLevel {
  return useMotion.getState().level;
}

/** Rust ayarındaki değer ("full" / "simple" / null) → seçim. */
export function settingFrom(v: string | null | undefined): MotionSetting {
  return v === "full" || v === "simple" ? v : "auto";
}

/** Bir kare 1/30 saniyeden uzun sürerse "takıldı" sayılır. */
const SLOW_FRAME_MS = 34;

/**
 * Bir animasyon süresince kareleri ölçer; karelerin çoğu yavaşsa oturum boyunca sadeye düşer.
 * Oyun açıkken ekran kartı dolu olabileceği için her önemli geçişte çalışır.
 */
export function watchFrames(durationMs = 600) {
  const st = useMotion.getState();
  if (st.setting !== "auto" || st.level !== "full") return;
  let last = performance.now();
  const end = last + durationMs;
  let frames = 0;
  let slow = 0;
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    frames++;
    if (dt > SLOW_FRAME_MS) slow++;
    if (now < end) requestAnimationFrame(tick);
    else if (frames >= 4 && slow / frames > 0.5) useMotion.getState().downgrade();
  };
  requestAnimationFrame(tick);
}
