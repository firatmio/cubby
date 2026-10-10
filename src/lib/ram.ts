export const RAM_STEP = 512;
export const RAM_MIN = 1024;
const RAM_CAP = 16384;
/** İşletim sistemi ve oyunun kendisi için bırakılan pay. */
const RAM_RESERVE = 2048;

/** Kaydırıcının üst sınırı ve önerilen başlangıç değeri. */
export function ramBounds(totalMb: number) {
  const max = Math.max(
    RAM_MIN,
    Math.min(RAM_CAP, Math.floor((totalMb - RAM_RESERVE) / RAM_STEP) * RAM_STEP),
  );
  const preferred = totalMb >= 12288 ? 4096 : totalMb >= 8192 ? 3072 : 2048;
  return { max, initial: Math.min(preferred, max) };
}

/** Başlangıç (Xms) değeri maksimumdan türetilir. */
export function ramMinFor(max: number): number {
  return Math.min(RAM_MIN, max);
}
