// Grafici su canvas: asse delle frequenze logaritmico o asse dei tempi lineare.

export interface Series { y: ArrayLike<number>; x: ArrayLike<number>; color: string; width?: number; dash?: number[]; alpha?: number; label?: string }

export interface PlotOptions {
  xLog: boolean;
  xRange: [number, number];
  yRange: [number, number];
  xTicks: number[];
  yStep: number;
  xLabel: (v: number) => string;
  yUnit: string;
  series: Series[];
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function drawPlot(canvas: HTMLCanvasElement, o: PlotOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pad = { l: 44, r: 10, t: 10, b: 24 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const fx = (v: number) => {
    const [a, b] = o.xRange;
    const t = o.xLog ? Math.log(v / a) / Math.log(b / a) : (v - a) / (b - a);
    return pad.l + t * pw;
  };
  const fy = (v: number) => pad.t + (1 - (v - o.yRange[0]) / (o.yRange[1] - o.yRange[0])) * ph;

  g.font = '11px system-ui, sans-serif';
  g.fillStyle = css('--muted');
  g.strokeStyle = css('--grid');
  g.lineWidth = 1;
  g.textAlign = 'center';
  for (const t of o.xTicks) {
    const x = Math.round(fx(t)) + 0.5;
    g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, pad.t + ph); g.stroke();
    g.fillText(o.xLabel(t), x, h - 8);
  }
  g.textAlign = 'right';
  for (let v = Math.ceil(o.yRange[0] / o.yStep) * o.yStep; v <= o.yRange[1]; v += o.yStep) {
    const y = Math.round(fy(v)) + 0.5;
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(pad.l + pw, y); g.stroke();
    g.fillText(`${v}${o.yUnit}`, pad.l - 6, y + 4);
  }

  g.save();
  g.beginPath(); g.rect(pad.l, pad.t, pw, ph); g.clip();
  for (const s of o.series) {
    g.strokeStyle = s.color;
    g.globalAlpha = s.alpha ?? 1;
    g.lineWidth = s.width ?? 1.5;
    g.setLineDash(s.dash ?? []);
    g.beginPath();
    let started = false;
    for (let i = 0; i < s.x.length; i++) {
      const xv = s.x[i];
      if (xv < o.xRange[0] || xv > o.xRange[1]) continue;
      const X = fx(xv), Y = fy(Math.max(o.yRange[0] - 20, Math.min(o.yRange[1] + 20, s.y[i])));
      if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
    }
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;
  g.setLineDash([]);
}

export const freqTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
export const freqLabel = (v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`);
