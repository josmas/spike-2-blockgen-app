/**
 * Builds the figures for academic_insights.md from the recorded benchmark
 * reports (reports/<timestamp>/results.json). Plain SVG, no dependencies.
 *
 *   npm run figures
 *
 * Writes figures/fig1-cost-time.svg, figures/fig2-construct-usage.svg and a
 * CSV with the data behind each. Reports are git-ignored, so the generated
 * files are what gets committed; this script reproduces them wherever the
 * reports exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {ResultsFile, RunResult} from './types';

export type Format = 'nested' | 'flat' | 'code';
export const FORMATS: Format[] = ['nested', 'flat', 'code'];

export interface LoadedRun {
  report: string;
  format: Format;
  run: RunResult;
}

/** Reads every report. Reports from before the flat format existed have no replyFormat and were nested. */
export function loadRuns(reportsDir: string): LoadedRun[] {
  if (!fs.existsSync(reportsDir)) return [];
  const out: LoadedRun[] = [];
  for (const name of fs.readdirSync(reportsDir).sort()) {
    const file = path.join(reportsDir, name, 'results.json');
    if (name === 'sample' || !fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as ResultsFile;
    for (const run of data.results) {
      const format = ((run as unknown as {replyFormat?: string}).replyFormat ?? 'nested') as Format;
      out.push({report: name, format, run});
    }
  }
  return out;
}

// ---- Figure 1: which constructs real programs use -----------------------------

/** Every supported construct the checker counts (src/llm/codeCheck.ts), as "ok:" keys without the prefix. */
export const ALL_SUPPORTED = [
  'var', 'function', 'if', 'for', 'for-of', 'while', 'break', 'continue', 'return', 'assign', 'update',
  'call', 'print', 'join', 'ternary', 'list-literal', 'index', 'length',
  'method:push', 'method:toUpperCase', 'method:toLowerCase', 'method:trim',
  'math:abs', 'math:sqrt', 'math:pow', 'math:floor', 'math:ceil', 'math:round', 'math:max', 'math:min', 'math:PI',
  'op:+', 'op:-', 'op:*', 'op:/', 'op:%', 'op:==', 'op:!=', 'op:===', 'op:!==', 'op:<', 'op:<=', 'op:>', 'op:>=',
  'op:&&', 'op:||', 'op:unary!', 'op:unary-',
];

const PRETTY: Record<string, string> = {
  var: 'var declaration', function: 'function declaration', for: 'for (counting loop)', 'for-of': 'for (var x of list)',
  assign: 'assignment (= += -= …)', update: 'i++ / i--', call: 'call to a user function', 'list-literal': 'list literal [a, b]',
  index: 'x[i] (1-based)', length: '.length', 'method:push': 'list.push(x)', 'method:toLowerCase': 'toLowerCase()',
  'method:toUpperCase': 'toUpperCase()', 'method:trim': 'trim()', 'op:unary-': 'unary minus', 'op:unary!': '! (not)',
};
export function prettyConstruct(key: string): string {
  if (PRETTY[key]) return PRETTY[key];
  if (key.startsWith('math:')) return `Math.${key.slice(5)}`;
  if (key.startsWith('op:')) return `operator ${key.slice(3)}`;
  return key;
}

export interface UsageRow {
  key: string;
  label: string;
  programs: number;
}

/** For each supported construct, in how many code-format programs it appeared (at least once). */
export function constructUsage(runs: LoadedRun[]): {rows: UsageRow[]; total: number; unused: string[]} {
  const code = runs.filter((r) => r.format === 'code' && r.run.status !== 'aborted' && r.run.attempts.length > 0);
  const counts = new Map<string, number>();
  for (const {run} of code) {
    const seen = new Set<string>();
    for (const attempt of run.attempts) {
      for (const key of Object.keys(attempt.constructs ?? {})) {
        if (key.startsWith('ok:')) seen.add(key.slice(3));
      }
    }
    for (const key of seen) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = [...counts]
    .map(([key, programs]) => ({key, label: prettyConstruct(key), programs}))
    .sort((a, b) => b.programs - a.programs || a.label.localeCompare(b.label));
  const unused = ALL_SUPPORTED.filter((k) => !counts.has(k));
  return {rows, total: code.length, unused};
}

// ---- Figure 2: cost and time per run, by representation ------------------------

export interface CostTimePoint {
  format: Format;
  model: string;
  task: string;
  seconds: number;
  cost: number;
}

/**
 * The fair comparison: only the given models and tasks (the ones every
 * format ran). Runs with no answered request cost nothing and cannot be drawn
 * on a log scale, so they are counted separately.
 */
export function costTimePoints(
  runs: LoadedRun[],
  models: string[],
  tasks: string[],
): {points: CostTimePoint[]; excluded: number} {
  const points: CostTimePoint[] = [];
  let excluded = 0;
  for (const {format, run} of runs) {
    if (!models.includes(run.model) || !tasks.includes(run.taskId) || run.status === 'aborted') continue;
    if (!(run.cost > 0) || !(run.durationMs > 0)) {
      excluded++;
      continue;
    }
    points.push({format, model: run.model, task: run.taskId, seconds: run.durationMs / 1000, cost: run.cost});
  }
  return {points, excluded};
}

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- SVG helpers --------------------------------------------------------------

const esc = (v: unknown): string =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (n: number): string => n.toFixed(1);

/** Ticks at 1, 3, 10, 30, ... covering [lo, hi]; the first and last tick are the axis limits. */
export function logTicks(lo: number, hi: number): number[] {
  const all: number[] = [];
  for (let k = Math.floor(Math.log10(lo)) - 1; k <= Math.ceil(Math.log10(hi)) + 1; k++) {
    for (const m of [1, 3]) all.push(Number((m * Math.pow(10, k)).toPrecision(6)));
  }
  const below = all.filter((v) => v <= lo * 1.000001);
  const above = all.filter((v) => v >= hi * 0.999999);
  return all.filter((v) => v >= below[below.length - 1] && v <= above[0]);
}

/** Splits text into lines of at most `max` characters, at spaces. */
export function wrapLines(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Chart tokens (see the dataviz palette): light and dark, as CSS custom properties. */
const STYLE = `
  :root { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7;
          --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; }
  @media (prefers-color-scheme: dark) {
    :root { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835;
            --s1:#3987e5; --s2:#d95926; --s3:#199e70; }
  }
  text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; fill: var(--ink2); font-size: 12px; }
  .ink { fill: var(--ink); } .muted { fill: var(--muted); font-size: 11px; }
  .grid { stroke: var(--grid); stroke-width: 1; } .axis { stroke: var(--axis); stroke-width: 1; }
  .bar { fill: var(--s1); }
`;

function svgOpen(width: number, height: number, title: string, desc: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<style>${STYLE}</style>
<rect width="${width}" height="${height}" fill="var(--surface)"/>`;
}

export function renderUsageFigure(usage: ReturnType<typeof constructUsage>, topN = 24): string {
  const rows = usage.rows.slice(0, topN);
  const left = 190;
  const right = 60;
  const width = 760;
  const rowH = 24;
  const top = 18;
  const plotW = width - left - right;
  const axisMax = Math.max(10, Math.ceil(usage.total / 10) * 10);
  const note = usage.unused.length ? wrapLines(`Never used: ${usage.unused.map(prettyConstruct).join(', ')}`, 92) : [];
  const height = top + rows.length * rowH + 52 + note.length * 16;
  const x = (v: number) => left + (v / axisMax) * plotW;

  let s = svgOpen(
    width,
    height,
    'Constructs used by real programs',
    `Horizontal bars: for each construct of the code dialect, the number of ${usage.total} programs written by models that used it, most used first.`,
  );
  for (let v = 0; v <= axisMax; v += axisMax <= 40 ? 5 : 10) {
    s += `<line class="grid" x1="${n1(x(v))}" x2="${n1(x(v))}" y1="${top}" y2="${top + rows.length * rowH}"/>`;
    s += `<text class="muted" x="${n1(x(v))}" y="${top + rows.length * rowH + 16}" text-anchor="middle">${v}</text>`;
  }
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.max(2, x(r.programs) - left);
    // Square at the baseline, 4 px rounded at the data end.
    s += `<g><title>${esc(r.label)}: ${r.programs} of ${usage.total} programs</title>
<text x="${left - 8}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(r.label)}</text>
<path class="bar" d="M${left},${y + 5} h${n1(Math.max(0, w - 4))} a4,4 0 0 1 4,4 v6 a4,4 0 0 1 -4,4 h-${n1(Math.max(0, w - 4))} z"/>
<text class="ink" x="${n1(left + w + 6)}" y="${y + rowH / 2 + 4}">${r.programs}</text></g>`;
  });
  s += `<line class="axis" x1="${left}" x2="${left}" y1="${top}" y2="${top + rows.length * rowH}"/>`;
  s += `<text x="${n1(left + plotW / 2)}" y="${top + rows.length * rowH + 36}" text-anchor="middle">programs using the construct (of ${usage.total})</text>`;
  note.forEach((line, i) => {
    s += `<text class="muted" x="${left - 150}" y="${top + rows.length * rowH + 58 + i * 16}">${esc(line)}</text>`;
  });
  return s + '\n</svg>\n';
}

const MARKERS: Record<Format, (cx: number, cy: number, r: number) => string> = {
  nested: (cx, cy, r) => `<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${r}"`,
  flat: (cx, cy, r) => `<rect x="${n1(cx - r)}" y="${n1(cy - r)}" width="${2 * r}" height="${2 * r}"`,
  code: (cx, cy, r) => `<path d="M${n1(cx)},${n1(cy - r - 1)} L${n1(cx + r + 1)},${n1(cy + r)} L${n1(cx - r - 1)},${n1(cy + r)} Z"`,
};
const SERIES_VAR: Record<Format, string> = {nested: '--s1', flat: '--s2', code: '--s3'};
const FORMAT_LABEL: Record<Format, string> = {nested: 'nested JSON', flat: 'flat block list', code: 'code dialect'};

export function renderCostTimeFigure(data: ReturnType<typeof costTimePoints>): string {
  const {points, excluded} = data;
  const width = 760;
  const height = 520;
  const m = {l: 84, r: 24, t: 20, b: 70};
  const plotW = width - m.l - m.r;
  const plotH = height - m.t - m.b;
  const xTicks = logTicks(Math.min(...points.map((p) => p.seconds)), Math.max(...points.map((p) => p.seconds)));
  const yTicks = logTicks(Math.min(...points.map((p) => p.cost)), Math.max(...points.map((p) => p.cost)));
  const [xMin, xMax] = [xTicks[0], xTicks[xTicks.length - 1]];
  const [yMin, yMax] = [yTicks[0], yTicks[yTicks.length - 1]];
  const px = (v: number) => m.l + ((Math.log10(v) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * plotW;
  const py = (v: number) => m.t + plotH - ((Math.log10(v) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * plotH;

  let s = svgOpen(
    width,
    height,
    'Cost and time per run by representation',
    'Scatter plot, both axes logarithmic: seconds and dollars per run for nested, flat and code replies from the same two models on the same two tasks.',
  );
  for (const v of xTicks) {
    s += `<line class="grid" x1="${n1(px(v))}" x2="${n1(px(v))}" y1="${m.t}" y2="${m.t + plotH}"/><text class="muted" x="${n1(px(v))}" y="${m.t + plotH + 16}" text-anchor="middle">${v}</text>`;
  }
  for (const v of yTicks) {
    s += `<line class="grid" x1="${m.l}" x2="${m.l + plotW}" y1="${n1(py(v))}" y2="${n1(py(v))}"/><text class="muted" x="${m.l - 8}" y="${n1(py(v) + 4)}" text-anchor="end">$${v}</text>`;
  }
  s += `<line class="axis" x1="${m.l}" x2="${m.l + plotW}" y1="${m.t + plotH}" y2="${m.t + plotH}"/><line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + plotH}"/>`;
  s += `<text x="${n1(m.l + plotW / 2)}" y="${height - 28}" text-anchor="middle">seconds per run (log scale)</text>`;
  s += `<text transform="translate(18 ${n1(m.t + plotH / 2)}) rotate(-90)" text-anchor="middle">dollars per run (log scale)</text>`;

  for (const format of FORMATS) {
    const mine = points.filter((p) => p.format === format);
    for (const p of mine) {
      s += `<g><title>${esc(`${FORMAT_LABEL[format]}: ${p.model.split('/')[1]}, ${p.task}: ${n1(p.seconds)} s, $${p.cost.toFixed(4)}`)}</title>${MARKERS[format](px(p.seconds), py(p.cost), 4.5)} fill="var(${SERIES_VAR[format]})" fill-opacity="0.9" stroke="var(--surface)" stroke-width="2"/></g>`;
    }
  }
  // Medians: a larger hollow marker per format, labelled directly.
  for (const format of FORMATS) {
    const mine = points.filter((p) => p.format === format);
    if (mine.length === 0) continue;
    const mx = px(median(mine.map((p) => p.seconds)));
    const my = py(median(mine.map((p) => p.cost)));
    s += `<g><title>${esc(`${FORMAT_LABEL[format]} median: ${n1(median(mine.map((p) => p.seconds)))} s, $${median(mine.map((p) => p.cost)).toFixed(4)}`)}</title>${MARKERS[format](mx, my, 9)} fill="none" stroke="var(${SERIES_VAR[format]})" stroke-width="2"/></g>`;
    // flat's median sits just under nested's, in the middle of a crowded cluster: put its label
    // in the open space to its right, level with the marker, instead of above it.
    const [dx, dy] = format === 'flat' ? [24, 5] : [14, -12];
    s += `<text class="ink" x="${n1(mx + dx)}" y="${n1(my + dy)}">${esc(format)}</text>`;
  }
  // Legend (always present for more than one series).
  let ly = m.t + 6;
  for (const format of FORMATS) {
    const n = points.filter((p) => p.format === format).length;
    s += `${MARKERS[format](m.l + plotW - 188, ly + 4, 4.5)} fill="var(${SERIES_VAR[format]})" stroke="var(--surface)" stroke-width="2"/>`;
    s += `<text x="${m.l + plotW - 176}" y="${ly + 8}">${esc(FORMAT_LABEL[format])} (n=${n})</text>`;
    ly += 20;
  }
  s += `<text class="muted" x="${m.l}" y="${height - 8}">Hollow marker: median. ${excluded} run${excluded === 1 ? '' : 's'} excluded (no answered request, so no cost to plot).</text>`;
  return s + '\n</svg>\n';
}

// ---- CSV twins ----------------------------------------------------------------

export function usageCsv(u: ReturnType<typeof constructUsage>): string {
  return ['construct,programs,total_programs', ...u.rows.map((r) => `${r.key},${r.programs},${u.total}`)].join('\n') + '\n';
}
export function costTimeCsv(points: CostTimePoint[]): string {
  return ['format,model,task,seconds,cost_usd', ...points.map((p) => `${p.format},${p.model},${p.task},${p.seconds.toFixed(2)},${p.cost.toFixed(6)}`)].join('\n') + '\n';
}

// ---- main ---------------------------------------------------------------------

function main(): void {
  const root = path.resolve(import.meta.dirname, '..');
  const runs = loadRuns(path.join(root, 'reports'));
  if (runs.length === 0) throw new Error('No reports found in reports/. Nothing to draw.');
  const outDir = path.join(root, 'figures');
  fs.mkdirSync(outDir, {recursive: true});

  const usage = constructUsage(runs);
  fs.writeFileSync(path.join(outDir, 'fig2-construct-usage.svg'), renderUsageFigure(usage));
  fs.writeFileSync(path.join(outDir, 'fig2-construct-usage.csv'), usageCsv(usage));

  // The two models that ran in every format, on the two tasks every format ran.
  const costTime = costTimePoints(runs, ['openai/gpt-5-mini', 'deepseek/deepseek-v4.1-flash'], ['bubble', 'faster']);
  fs.writeFileSync(path.join(outDir, 'fig1-cost-time.svg'), renderCostTimeFigure(costTime));
  fs.writeFileSync(path.join(outDir, 'fig1-cost-time.csv'), costTimeCsv(costTime.points));

  console.log(`Wrote figures/ from ${runs.length} runs: ${usage.total} code programs, ${costTime.points.length} cost/time points (${costTime.excluded} excluded).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
