// The sizes the editor offers for a Word equation: the Chinese size names Word lists first, then point sizes.

export const CHINESE_FONT_SIZES = [
  { name: "初号", pt: 42 },
  { name: "小初", pt: 36 },
  { name: "一号", pt: 26 },
  { name: "小一", pt: 24 },
  { name: "二号", pt: 22 },
  { name: "小二", pt: 18 },
  { name: "三号", pt: 16 },
  { name: "小三", pt: 15 },
  { name: "四号", pt: 14 },
  { name: "小四", pt: 12 },
  { name: "五号", pt: 10.5 },
  { name: "小五", pt: 9 },
  { name: "六号", pt: 7.5 },
  { name: "小六", pt: 6.5 },
  { name: "七号", pt: 5.5 },
  { name: "八号", pt: 5 },
] as const;

const CHINESE_POINTS = new Set<number>(CHINESE_FONT_SIZES.map((size) => size.pt));

const POINT_SIZES = [
  ...Array.from({ length: 63 }, (_, index) => 5 + index * 0.5),
  ...Array.from({ length: 18 }, (_, index) => 38 + index * 2),
  80, 90, 96, 100, 120, 144, 160, 180, 200,
].filter((pt) => !CHINESE_POINTS.has(pt));

/** The point sizes to list, the current one included (a document may use any size). */
export function pointSizes(current: number): number[] {
  return CHINESE_POINTS.has(current) || POINT_SIZES.includes(current)
    ? POINT_SIZES
    : [...POINT_SIZES, current].sort((a, b) => a - b);
}

/** A size Word accepts: 5 to 200 pt, in hundredths. */
export function wordFontSize(value: number): number {
  return Math.round(Math.min(200, Math.max(5, value)) * 100) / 100;
}
