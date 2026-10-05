import './helpers/setup';
import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import type {RunResult} from '../types';
import {
  constructUsage,
  costTimeCsv,
  costTimePoints,
  logTicks,
  median,
  renderCostTimeFigure,
  renderUsageFigure,
  usageCsv,
  wrapLines,
} from '../figures';
import type {Format, LoadedRun} from '../figures';

/** A minimal run: only the fields the figures read. */
function run(format: Format, over: Partial<RunResult> & {constructs?: Record<string, number>} = {}): LoadedRun {
  const {constructs, ...rest} = over;
  return {
    report: 'r',
    format,
    run: {
      model: 'openai/gpt-5-mini', taskId: 'bubble', status: 'correct', durationMs: 5000, cost: 0.001,
      attempts: [{attempt: 1, outcome: 'accepted', errors: [], categories: [], reply: '', replyChars: 0, temperature: 0.2, stats: null, constructs: constructs ?? {'ok:var': 2, 'ok:op:<=': 1}}],
      ...rest,
    } as unknown as RunResult,
  };
}

describe('figure data: construct usage', () => {
  it('counts programs, not occurrences, and only code-format programs', () => {
    const runs = [
      run('code', {constructs: {'ok:var': 5, 'ok:while': 1}}),
      run('code', {constructs: {'ok:var': 1}}),
      run('flat', {constructs: {'ok:var': 1, 'ok:for': 9}}),
    ];
    const u = constructUsage(runs);
    assert.equal(u.total, 2);
    assert.deepEqual(u.rows.map((r) => [r.key, r.programs]), [['var', 2], ['while', 1]]);
  });
  it('ignores unsupported-construct keys and lists never-used supported constructs', () => {
    const u = constructUsage([run('code', {constructs: {'ok:var': 1, 'method:sort': 3}})]);
    assert.ok(!u.rows.some((r) => r.key.includes('sort')));
    assert.ok(u.unused.includes('ternary') && !u.unused.includes('var'));
  });
  it('counts a construct once per program even if it appears in several attempts', () => {
    const r = run('code');
    r.run.attempts.push({...r.run.attempts[0], attempt: 2});
    assert.equal(constructUsage([r]).rows.find((x) => x.key === 'var')?.programs, 1);
  });
  it('gives readable labels and a CSV with the totals', () => {
    const u = constructUsage([run('code', {constructs: {'ok:index': 1, 'ok:op:<=': 1, 'ok:math:floor': 1}})]);
    assert.deepEqual(u.rows.map((r) => r.label).sort(), ['Math.floor', 'operator <=', 'x[i] (1-based)']);
    assert.match(usageCsv(u), /^construct,programs,total_programs\n/);
    assert.match(usageCsv(u), /\nindex,1,1\n/);
  });
});

describe('figure data: cost and time', () => {
  it('keeps only the chosen models and tasks, and sets aside runs that cost nothing', () => {
    const runs = [
      run('code'),
      run('nested', {cost: 0, durationMs: 100}),
      run('flat', {model: 'z-ai/glm-5.3-flash'}),
      run('flat', {taskId: 'parity'}),
      run('flat', {status: 'aborted'}),
    ];
    const {points, excluded} = costTimePoints(runs, ['openai/gpt-5-mini'], ['bubble']);
    assert.equal(points.length, 1);
    assert.equal(excluded, 1);
    assert.equal(points[0].seconds, 5);
  });
  it('writes a CSV row per point', () => {
    const {points} = costTimePoints([run('code')], ['openai/gpt-5-mini'], ['bubble']);
    assert.equal(costTimeCsv(points), 'format,model,task,seconds,cost_usd\ncode,openai/gpt-5-mini,bubble,5.00,0.001000\n');
  });
  it('median works for odd and even counts', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
  });
});

describe('figure drawing', () => {
  it('log ticks sit at 1, 3, 10, 30... and cover the data', () => {
    assert.deepEqual(logTicks(4, 140), [3, 10, 30, 100, 300]);
    assert.deepEqual(logTicks(0.00018, 0.037), [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1]);
  });
  it('wraps text at spaces without losing words', () => {
    const lines = wrapLines('one two three four five', 10);
    assert.ok(lines.every((l) => l.length <= 10));
    assert.equal(lines.join(' '), 'one two three four five');
  });
  it('the usage figure is well-formed SVG with a title, a dark-mode style and one bar per row', () => {
    const svg = renderUsageFigure(constructUsage([run('code', {constructs: {'ok:var': 1, 'ok:if': 1}})]));
    assert.match(svg, /^<svg [^>]*viewBox/);
    assert.match(svg, /<title id="t">/);
    assert.match(svg, /prefers-color-scheme: dark/);
    assert.equal((svg.match(/class="bar"/g) ?? []).length, 2);
    assert.ok(svg.trim().endsWith('</svg>'));
  });
  it('the cost figure marks each format with its own shape (not colour alone) and escapes text', () => {
    const data = costTimePoints([run('nested'), run('flat'), run('code', {model: 'openai/gpt-5-mini'})], ['openai/gpt-5-mini'], ['bubble']);
    const svg = renderCostTimeFigure(data);
    assert.match(svg, /<circle/);
    assert.match(svg, /<rect x=/);
    assert.match(svg, /<path d="M[\d.]+,[\d.]+ L/);
    assert.ok(!/<<|&(?!amp;|lt;|gt;|quot;)/.test(svg), 'unescaped markup');
    assert.match(svg, /n=1/);
  });
});
