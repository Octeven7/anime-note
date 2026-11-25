import { readFileSync } from 'node:fs';
const css = readFileSync('src/styles.css', 'utf8');
function values(selector) {
  const expression =
    selector === ':root' ? /:root\s*\{([^}]+)\}/ : /\[data-theme=['"]?dark['"]?\]\s*\{([^}]+)\}/;
  const block = css.match(expression)?.[1];
  if (!block) throw new Error(`Missing color tokens: ${selector}`);
  const result = {};
  for (const match of block.matchAll(/--([a-z-]+):([^;]+)/g)) result[match[1]] = match[2].trim();
  return result;
}
function channels(color) {
  if (color.startsWith('#')) return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  return color
    .split(/\s+/)
    .map(Number)
    .map((n) => n / 255);
}
function luminance(color) {
  const linear = channels(color).map((n) =>
    n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
let failed = false;
for (const selector of [':root', '[data-theme=dark]']) {
  const c = values(selector);
  for (const [text, bg, min] of [
    ['ink', 'canvas', 4.5],
    ['muted', 'canvas', 4.5],
    ['muted', 'surface', 4.5],
    ['brand', 'surface', 4.5],
    ['brand-on', 'brand', 4.5],
    ['control', 'surface', 3],
    ...['awful', 'weak', 'fair', 'good', 'master'].map((k) => [k, k + '-bg', 4.5]),
  ]) {
    const a = luminance(c[text]),
      b = luminance(c[bg]),
      ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < min) failed = true;
    console.log(
      `${ratio >= min ? 'PASS' : 'FAIL'} ${selector} ${text}/${bg}: ${ratio.toFixed(2)} (min ${min})`,
    );
  }
}
process.exitCode = failed ? 1 : 0;
