// File di calibrazione del microfono (formato miniDSP/REW: "frequenza dB [fase]" per riga).

export function parseMicCal(text: string): (f: number) => number {
  const pts: [number, number][] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^[*"#;a-z]/i.test(t)) continue;
    const nums = t.split(/[\s,;]+/).map(Number);
    if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1]) && nums[0] > 0) pts.push([nums[0], nums[1]]);
  }
  if (pts.length < 2) throw new Error('File di calibrazione non valido');
  pts.sort((a, b) => a[0] - b[0]);
  return (f: number) => {
    if (f <= pts[0][0]) return pts[0][1];
    if (f >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= f) lo = mid; else hi = mid; }
    const t = Math.log(f / pts[lo][0]) / Math.log(pts[hi][0] / pts[lo][0]);
    return pts[lo][1] + t * (pts[hi][1] - pts[lo][1]);
  };
}
