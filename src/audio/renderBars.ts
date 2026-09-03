/**
 * Custom wavesurfer v7 renderFunction: rounded thin bars drawn twice — a blurred, semi-transparent pass
 * underneath for glow, then the crisp bars. `ctx.fillStyle` arrives already set to wavesurfer's
 * vertical gradient (waveColor / progressColor arrays), and the progress canvas is a recolored copy,
 * so the played part glows teal and the rest glows slate.
 */
export interface BarStyle {
  barWidth: number;
  barGap: number;
  barRadius: number;
  glowBlurPx: number;
  glowAlpha: number;
}

export const DEFAULT_BAR_STYLE: BarStyle = { barWidth: 2, barGap: 1.5, barRadius: 2, glowBlurPx: 7, glowAlpha: 0.55 };

export function makeBarRenderer(style: BarStyle = DEFAULT_BAR_STYLE) {
  return function renderBars(channelData: Array<Float32Array | number[]>, ctx: CanvasRenderingContext2D): void {
    const { width, height } = ctx.canvas;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const top = channelData[0];
    const bottom = channelData[1] ?? channelData[0];
    if (!top || !top.length || !width || !height) return;

    const barW = style.barWidth * dpr;
    const gap = style.barGap * dpr;
    const step = barW + gap;
    const radius = Math.min(style.barRadius * dpr, barW / 2);
    const barCount = Math.max(1, Math.floor(width / step));
    const spb = top.length / barCount;
    const halfH = height / 2;
    const vScale = halfH * 0.94;

    // peak per bar (top channel up, bottom channel down)
    const ups = new Float32Array(barCount);
    const downs = new Float32Array(barCount);
    for (let i = 0; i < barCount; i++) {
      const a = Math.floor(i * spb);
      const b = Math.min(top.length, Math.max(a + 1, Math.floor((i + 1) * spb)));
      let u = 0, d = 0;
      for (let j = a; j < b; j++) {
        const t = Math.abs(top[j]);
        const bt = Math.abs(bottom[j]);
        if (t > u) u = t;
        if (bt > d) d = bt;
      }
      ups[i] = u;
      downs[i] = d;
    }

    const minH = Math.max(1, 0.6 * dpr);
    const drawPass = (widen: number) => {
      ctx.beginPath();
      for (let i = 0; i < barCount; i++) {
        const x = i * step - widen / 2;
        const y0 = halfH - Math.max(minH, ups[i] * vScale);
        const y1 = halfH + Math.max(minH, downs[i] * vScale);
        const w = barW + widen;
        const h = y1 - y0;
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y0, w, h, radius);
        else ctx.rect(x, y0, w, h);
      }
      ctx.fill();
    };

    // 1) glow: blurred, softer, slightly wider
    if (style.glowBlurPx > 0 && 'filter' in ctx) {
      ctx.save();
      ctx.filter = `blur(${style.glowBlurPx * dpr}px)`;
      ctx.globalAlpha = style.glowAlpha;
      drawPass(barW * 0.6);
      ctx.restore();
    }
    // 2) crisp bars
    drawPass(0);
  };
}
