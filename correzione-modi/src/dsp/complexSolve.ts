// Risoluzione di piccoli sistemi lineari complessi A x = b (eliminazione di Gauss con pivot parziale).

/** A è K×K in ordine per righe; i vettori vengono modificati. Restituisce x in (bRe, bIm). */
export function solveComplex(
  aRe: Float64Array, aIm: Float64Array, bRe: Float64Array, bIm: Float64Array, K: number,
): void {
  for (let col = 0; col < K; col++) {
    let piv = col;
    let best = -1;
    for (let r = col; r < K; r++) {
      const m = aRe[r * K + col] ** 2 + aIm[r * K + col] ** 2;
      if (m > best) { best = m; piv = r; }
    }
    if (best <= 0) throw new Error('Sistema singolare');
    if (piv !== col) {
      for (let c = 0; c < K; c++) {
        swap(aRe, piv * K + c, col * K + c);
        swap(aIm, piv * K + c, col * K + c);
      }
      swap(bRe, piv, col);
      swap(bIm, piv, col);
    }
    const pr = aRe[col * K + col], pi = aIm[col * K + col];
    const pd = pr * pr + pi * pi;
    for (let r = col + 1; r < K; r++) {
      const xr = aRe[r * K + col], xi = aIm[r * K + col];
      // f = a[r][col] / pivot
      const fr = (xr * pr + xi * pi) / pd;
      const fi = (xi * pr - xr * pi) / pd;
      for (let c = col; c < K; c++) {
        const yr = aRe[col * K + c], yi = aIm[col * K + c];
        aRe[r * K + c] -= fr * yr - fi * yi;
        aIm[r * K + c] -= fr * yi + fi * yr;
      }
      bRe[r] -= fr * bRe[col] - fi * bIm[col];
      bIm[r] -= fr * bIm[col] + fi * bRe[col];
    }
  }
  for (let r = K - 1; r >= 0; r--) {
    let sr = bRe[r], si = bIm[r];
    for (let c = r + 1; c < K; c++) {
      const ar = aRe[r * K + c], ai = aIm[r * K + c];
      sr -= ar * bRe[c] - ai * bIm[c];
      si -= ar * bIm[c] + ai * bRe[c];
    }
    const pr = aRe[r * K + r], pi = aIm[r * K + r];
    const pd = pr * pr + pi * pi;
    bRe[r] = (sr * pr + si * pi) / pd;
    bIm[r] = (si * pr - sr * pi) / pd;
  }
}

function swap(a: Float64Array, i: number, j: number) {
  const t = a[i]; a[i] = a[j]; a[j] = t;
}
