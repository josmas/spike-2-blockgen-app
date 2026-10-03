import {
  FIRST_TEMPERATURE,
  MAX_ATTEMPTS,
  MAX_TOKENS,
  REASONING_EFFORT,
  RETRY_TEMPERATURE,
} from '../src/config';
import {CATEGORY_LABELS} from './classify';
import {pct, summarize, usd} from './summary';
import type {ModelSummary} from './summary';
import {TASKS} from './tasks';
import type {FailureCategory, ResultsFile, RunResult, RunStatus} from './types';

/** Builds one self-contained HTML file (no external requests). */
export function buildReport(file: ResultsFile): string {
  const {meta, results} = file;
  const finished = results.filter((r) => r.status !== 'aborted');
  const summaries = summarize(results);
  const taskLabel = (id: string) => TASKS.find((t) => t.id === id)?.label ?? id;

  const correct = finished.filter((r) => r.status === 'correct').length;
  const wrong = finished.filter((r) => r.status === 'wrong').length;
  const failed = finished.filter((r) => r.status === 'failed').length;
  const wallMs =
    meta.finishedAt ? Date.parse(meta.finishedAt) - Date.parse(meta.startedAt) : 0;

  const body = `
<header>
  <h1>Block generation benchmark</h1>
  <p class="sub">${esc(new Date(meta.startedAt).toLocaleString('en-GB'))} ·
    ${meta.models.length} models · ${meta.taskIds.map((t) => esc(taskLabel(t))).join(', ')} ·
    ${meta.trials} trials each</p>
  ${meta.stoppedEarly ? `<p class="banner"><span class="icon warn" aria-hidden="true">!</span>This run stopped early, so some models have fewer runs than planned. ${meta.notes.map(esc).join(' ')}</p>` : ''}
</header>

<section class="kpis" aria-label="Headline numbers">
  ${tile('Runs finished', String(finished.length), `of ${meta.models.length * meta.taskIds.length * meta.trials} planned`)}
  ${tile('Correct', pct(correct, finished.length), `${correct} of ${finished.length} runs`)}
  ${tile('Accepted but wrong', pct(wrong, finished.length), 'passed validation, failed a check')}
  ${tile('Failed', pct(failed, finished.length), 'never produced a valid workspace')}
  ${tile('Spend', usd(meta.spentUsd, 2), `cap ${usd(meta.capUsd, 2)}`)}
</section>

<section class="card">
  <h2>Outcome by model</h2>
  <p class="note">Each run is one request typed into the app, with up to ${MAX_ATTEMPTS} attempts.
  "Accepted but wrong" means the app accepted the workspace but the generated code failed a correctness check.</p>
  ${legend()}
  <div class="rows">${summaries.map(outcomeRow).join('')}</div>
</section>

<section class="grid2">
  <div class="card">
    <h2>Median time per run</h2>
    <p class="note">Seconds from request to final answer, retries included.</p>
    <div class="rows">${barRows(summaries, (s) => s.medianSeconds, (v) => `${v.toFixed(1)}s`, 'median time')}</div>
  </div>
  <div class="card">
    <h2>Mean cost per run</h2>
    <p class="note">USD, as charged by OpenRouter.</p>
    <div class="rows">${barRows(summaries, (s) => s.meanCost, (v) => usd(v), 'mean cost')}</div>
  </div>
</section>

<section class="card">
  <h2>Why attempts fail</h2>
  <p class="note">Count of rejected or errored attempts by cause, across all runs. A single run can have up to ${MAX_ATTEMPTS}.
  Darker means more.</p>
  ${heatmap(summaries)}
</section>

<section class="card">
  <h2>All numbers</h2>
  <p class="note">The table behind the charts. Click a column heading to sort.</p>
  ${statsTable(summaries, meta.taskIds, taskLabel)}
</section>

<section class="card">
  <h2>Runs</h2>
  ${runFilters(finished, taskLabel)}
  <p class="note" id="run-count" aria-live="polite"></p>
  <div id="runs">${finished.map((r) => runDetails(r, taskLabel)).join('')}</div>
</section>

<footer class="note">
  <h2>How these numbers were produced</h2>
  <ul>
    <li>The script calls the app's own <code>generate()</code>, so the prompt, parser, validation and retries are the app's.
        First attempt at temperature ${FIRST_TEMPERATURE}, retries at ${RETRY_TEMPERATURE}; reasoning effort "${esc(REASONING_EFFORT)}"; up to ${MAX_TOKENS.toLocaleString('en-US')} output tokens.</li>
    <li>Reply format: <code>${esc(meta.replyFormatMode ?? 'nested')}</code> (nested = Blockly's own JSON; flat = a flat block list the app assembles).</li>
    <li>Response format: <code>${esc(meta.responseFormatMode)}</code>${meta.strictRouting ? '; strict routing on (require_parameters, no fallbacks)' : '; default OpenRouter routing'}.</li>
    <li><strong>Correct</strong> runs are executed in a sandbox: the function must sort nine fixed inputs, the program must run without error, and the built-in sort block is not allowed.
        The "faster" task also sorts 100,000 numbers within 3 seconds, which rules out quadratic algorithms such as bubble sort. It does not prove the algorithm is quick sort or merge sort.</li>
    <li>With a handful of trials per cell, small differences between models are noise. Providers can also change between runs unless strict routing is on; the providers seen are listed per model.</li>
  </ul>
</footer>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Block generation benchmark</title>
<style>${CSS}</style>
</head>
<body>
<main>${body}</main>
<div id="tip" role="tooltip" hidden></div>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}

// ---- pieces ---------------------------------------------------------------

const STATUS: Record<RunStatus, {icon: string; label: string; css: string}> = {
  correct: {icon: '✓', label: 'Correct', css: 'good'},
  wrong: {icon: '!', label: 'Accepted but wrong', css: 'warn'},
  failed: {icon: '✕', label: 'Failed', css: 'crit'},
  aborted: {icon: '–', label: 'Aborted', css: 'mute'},
};

function tile(label: string, value: string, hint: string): string {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div><div class="tile-hint">${esc(hint)}</div></div>`;
}

function legend(): string {
  const item = (s: RunStatus) =>
    `<span class="key"><span class="icon ${STATUS[s].css}" aria-hidden="true">${STATUS[s].icon}</span>${STATUS[s].label}</span>`;
  return `<div class="legend">${item('correct')}${item('wrong')}${item('failed')}</div>`;
}

function outcomeRow(s: ModelSummary): string {
  const seg = (status: RunStatus, count: number) =>
    count
      ? `<span class="seg ${STATUS[status].css}" tabindex="0" style="width:${(count / s.runs) * 100}%" data-tip="${attr(`${s.model} — ${STATUS[status].label}: ${count} of ${s.runs} runs (${pct(count, s.runs)})`)}"></span>`
      : '';
  return `<div class="row">
    <div class="label" title="${attr(s.model)}">${esc(s.model)}</div>
    <div class="track">${seg('correct', s.correct)}${seg('wrong', s.wrong)}${seg('failed', s.failed)}</div>
    <div class="end">${s.correct}/${s.runs} correct</div>
  </div>`;
}

function barRows(
  summaries: ModelSummary[],
  pick: (s: ModelSummary) => number | null,
  format: (v: number) => string,
  what: string,
): string {
  const values = summaries.map(pick);
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  return summaries
    .map((s, i) => {
      const v = values[i];
      const width = v !== null && max > 0 ? Math.max((v / max) * 100, 0.5) : 0;
      return `<div class="row">
      <div class="label" title="${attr(s.model)}">${esc(s.model)}</div>
      <div class="track"><span class="bar" tabindex="0" style="width:${width}%" data-tip="${attr(`${s.model} — ${what}: ${v === null ? 'n/a' : format(v)}`)}"></span></div>
      <div class="end">${v === null ? 'n/a' : esc(format(v))}</div>
    </div>`;
    })
    .join('');
}

function heatmap(summaries: ModelSummary[]): string {
  const used = (Object.keys(CATEGORY_LABELS) as FailureCategory[]).filter((c) =>
    summaries.some((s) => s.categories[c]),
  );
  if (used.length === 0) {
    return '<p class="note">No attempt failed. Nothing to show.</p>';
  }
  const max = Math.max(...summaries.flatMap((s) => used.map((c) => s.categories[c] ?? 0)));
  const head = used.map((c) => `<th scope="col">${esc(CATEGORY_LABELS[c])}</th>`).join('');
  const rows = summaries
    .map((s) => {
      const cells = used
        .map((c) => {
          const n = s.categories[c] ?? 0;
          const v = max ? n / max : 0;
          return `<td class="${v > 0.5 ? 'hi' : ''}" style="--v:${v.toFixed(3)}" tabindex="0" data-tip="${attr(`${s.model} — ${CATEGORY_LABELS[c]}: ${n} attempt(s)`)}">${n || ''}</td>`;
        })
        .join('');
      return `<tr><th scope="row" title="${attr(s.model)}">${esc(s.model)}</th>${cells}</tr>`;
    })
    .join('');
  return `<div class="scroll"><table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function statsTable(
  summaries: ModelSummary[],
  taskIds: string[],
  taskLabel: (id: string) => string,
): string {
  const num = (v: number | null, f: (n: number) => string) => (v === null ? 'n/a' : f(v));
  const cols: Array<{head: string; sort: (s: ModelSummary) => number | string; show: (s: ModelSummary) => string}> = [
    {head: 'Model', sort: (s) => s.model, show: (s) => esc(s.model)},
    {head: 'Runs', sort: (s) => s.runs, show: (s) => String(s.runs)},
    {head: 'Correct', sort: (s) => s.correct / s.runs, show: (s) => `${s.correct} (${pct(s.correct, s.runs)})`},
    {head: 'Accepted but wrong', sort: (s) => s.wrong, show: (s) => String(s.wrong)},
    {head: 'Failed', sort: (s) => s.failed, show: (s) => String(s.failed)},
    {head: 'Right first try', sort: (s) => s.firstAttemptAccepted / s.runs, show: (s) => pct(s.firstAttemptAccepted, s.runs)},
    {head: 'Mean attempts', sort: (s) => s.meanAttempts ?? 0, show: (s) => num(s.meanAttempts, (n) => n.toFixed(1))},
    {head: 'Median time', sort: (s) => s.medianSeconds ?? 0, show: (s) => num(s.medianSeconds, (n) => `${n.toFixed(1)}s`)},
    {head: 'Slowest', sort: (s) => s.maxSeconds ?? 0, show: (s) => num(s.maxSeconds, (n) => `${n.toFixed(1)}s`)},
    {head: 'Median to first data', sort: (s) => s.medianFirstDataSeconds ?? 0, show: (s) => num(s.medianFirstDataSeconds, (n) => `${n.toFixed(1)}s`)},
    {head: 'Cost per run', sort: (s) => s.meanCost ?? 0, show: (s) => usd(s.meanCost)},
    {head: 'Total cost', sort: (s) => s.totalCost, show: (s) => usd(s.totalCost)},
    {head: 'Output tokens', sort: (s) => s.meanCompletionTokens ?? 0, show: (s) => num(s.meanCompletionTokens, (n) => Math.round(n).toLocaleString('en-US'))},
    {head: 'Reasoning tokens', sort: (s) => s.meanReasoningTokens ?? 0, show: (s) => num(s.meanReasoningTokens, (n) => Math.round(n).toLocaleString('en-US'))},
    ...taskIds.map((id) => ({
      head: `${taskLabel(id)} correct`,
      sort: (s: ModelSummary) => (s.byTask[id] ? s.byTask[id].correct / s.byTask[id].runs : 0),
      show: (s: ModelSummary) => (s.byTask[id] ? `${s.byTask[id].correct}/${s.byTask[id].runs}` : 'n/a'),
    })),
    {head: 'Providers seen', sort: (s) => s.providers.join(), show: (s) => esc(s.providers.join(', ') || 'n/a')},
  ];
  const head = cols
    .map((c, i) => `<th scope="col"><button type="button" class="sortbtn" data-col="${i}">${esc(c.head)}</button></th>`)
    .join('');
  const rows = summaries
    .map(
      (s) =>
        `<tr>${cols
          .map((c, i) => {
            const key = c.sort(s);
            return `<${i === 0 ? 'th scope="row"' : 'td'} data-sort="${attr(String(key))}">${c.show(s)}</${i === 0 ? 'th' : 'td'}>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return `<div class="scroll"><table class="stats" id="stats"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function runFilters(runs: RunResult[], taskLabel: (id: string) => string): string {
  const options = (values: string[], label: (v: string) => string) =>
    ['<option value="">All</option>', ...values.map((v) => `<option value="${attr(v)}">${esc(label(v))}</option>`)].join('');
  const models = [...new Set(runs.map((r) => r.model))];
  const tasks = [...new Set(runs.map((r) => r.taskId))];
  const statuses = (['correct', 'wrong', 'failed'] as RunStatus[]).filter((s) => runs.some((r) => r.status === s));
  return `<div class="filters">
    <label>Model <select id="f-model">${options(models, (v) => v)}</select></label>
    <label>Task <select id="f-task">${options(tasks, taskLabel)}</select></label>
    <label>Outcome <select id="f-status">${options(statuses, (v) => STATUS[v as RunStatus].label)}</select></label>
  </div>`;
}

function runDetails(r: RunResult, taskLabel: (id: string) => string): string {
  const st = STATUS[r.status];
  const attempts = r.attempts
    .map((a) => {
      const cats = a.categories.map((c) => CATEGORY_LABELS[c]).join(', ');
      const s = a.stats;
      const meta = s
        ? `${(s.totalMs / 1000).toFixed(1)}s total${s.firstDataMs !== null ? `, ${(s.firstDataMs / 1000).toFixed(1)}s to first data` : ''}; ${s.reasoningChars.toLocaleString('en-US')} reasoning chars, ${s.contentChars.toLocaleString('en-US')} answer chars; finish: ${s.finishReason ?? 'n/a'}${s.provider ? `; provider: ${s.provider}` : ''}${s.usage?.cost != null ? `; ${usd(s.usage.cost)}` : ''}`
        : '';
      return `<li><strong>Attempt ${a.attempt}</strong> (temperature ${a.temperature}): ${esc(a.outcome)}${cats ? ` — ${esc(cats)}` : ''}
        <div class="small">${esc(meta)}</div>
        ${a.errors.length ? `<ul class="errs">${a.errors.map((e) => `<li>${esc(e.slice(0, 600))}</li>`).join('')}</ul>` : ''}
        ${a.reply ? `<details><summary>Raw reply (${a.replyChars.toLocaleString('en-US')} chars)</summary><pre>${esc(a.reply.slice(0, 30000))}${a.reply.length > 30000 ? '\n… shown truncated; the full reply is in results.json' : ''}</pre></details>` : ''}
      </li>`;
    })
    .join('');
  const checks = r.checks.length
    ? `<table class="checks"><tbody>${r.checks
        .map((c) => `<tr><td><span class="icon ${c.passed ? 'good' : 'crit'}" aria-hidden="true">${c.passed ? '✓' : '✕'}</span>${c.passed ? 'Pass' : 'Fail'}</td><td>${esc(c.name)}</td><td>${esc(c.detail)}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
  return `<details class="run" data-model="${attr(r.model)}" data-task="${attr(r.taskId)}" data-status="${r.status}">
    <summary><span class="icon ${st.css}" aria-hidden="true">${st.icon}</span><strong>${esc(st.label)}</strong>
      <span class="rm">${esc(r.model)}</span> · ${esc(taskLabel(r.taskId))} #${r.trial} ·
      ${r.attempts.length} attempt${r.attempts.length === 1 ? '' : 's'} · ${(r.durationMs / 1000).toFixed(1)}s · ${usd(r.cost)}</summary>
    <div class="run-body">
      ${r.finalError ? `<p class="err">${esc(r.finalError.slice(0, 800))}</p>` : ''}
      ${r.summary ? `<p><em>${esc(r.summary)}</em></p>` : ''}
      <p class="small">Reply format: ${esc(r.replyFormat ?? 'nested')} · Providers: ${esc(r.providers.join(', ') || 'n/a')} · tokens in ${r.promptTokens.toLocaleString('en-US')}, out ${r.completionTokens.toLocaleString('en-US')} (reasoning ${r.reasoningTokens.toLocaleString('en-US')})${r.costEstimated ? ' · cost partly estimated' : ''}${r.blockCount !== null ? ` · ${r.blockCount} blocks` : ''}</p>
      ${checks}
      ${r.programOutput.length ? `<p class="small">Program output:</p><pre>${esc(r.programOutput.join('\n'))}</pre>` : ''}
      <ol class="attempts">${attempts}</ol>
      ${r.code ? `<details><summary>Generated JavaScript</summary><pre>${esc(r.code)}</pre></details>` : ''}
    </div>
  </details>`;
}

// ---- escaping -------------------------------------------------------------

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const attr = esc;

// ---- styles and behaviour -------------------------------------------------

const CSS = `
:root {
  color-scheme: light;
  --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
  --series: #2a78d6; --good: #0ca30c; --warn: #fab219; --crit: #d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10); --series: #3987e5;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10); --series: #3987e5;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1120px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0 0 4px; }
.sub, .note { color: var(--ink2); margin: 0 0 12px; font-size: 14px; }
.small { color: var(--ink2); font-size: 13px; }
.card, .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.card { margin: 16px 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid2 .card { margin: 16px 0 0; }
@media (max-width: 860px) { .grid2 { grid-template-columns: 1fr; } }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-top: 16px; }
.tile-label { color: var(--ink2); font-size: 13px; }
.tile-value { font-size: 32px; font-weight: 600; line-height: 1.2; }
.tile-hint { color: var(--muted); font-size: 12px; }
.banner { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; margin: 12px 0 0; }
.icon { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; font-size: 11px; font-weight: 700; margin-right: 6px; color: #fff; vertical-align: -2px; }
.icon.good, .seg.good { background: var(--good); } .icon.warn, .seg.warn { background: var(--warn); } .icon.crit, .seg.crit { background: var(--crit); } .icon.mute { background: var(--muted); }
.icon.warn { color: #0b0b0b; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 4px 0 12px; font-size: 13px; color: var(--ink2); }
.rows { display: grid; gap: 8px; }
.row { display: grid; grid-template-columns: minmax(120px, 220px) 1fr 110px; gap: 12px; align-items: center; }
@media (max-width: 600px) {
  .row { grid-template-columns: 1fr auto; gap: 2px 12px; }
  .row .label { grid-column: 1 / -1; }
}
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--ink2); }
.end { font-size: 13px; color: var(--ink2); white-space: nowrap; }
.track { display: flex; gap: 2px; height: 20px; align-items: center; border-left: 1px solid var(--axis); }
.seg { height: 20px; min-width: 3px; outline-offset: 1px; }
.seg:last-child { border-radius: 0 4px 4px 0; }
.bar { height: 16px; background: var(--series); border-radius: 0 4px 4px 0; display: block; outline-offset: 1px; }
.seg:hover, .bar:hover, .seg:focus-visible, .bar:focus-visible { filter: brightness(1.12); outline: 2px solid var(--ink); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--grid); white-space: nowrap; }
.stats td { font-variant-numeric: tabular-nums; }
.heat th[scope=row] { font-weight: 400; color: var(--ink2); max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.heat thead th { font-weight: 500; color: var(--ink2); white-space: normal; min-width: 90px; vertical-align: bottom; }
.heat td { text-align: center; background: color-mix(in srgb, var(--series) calc(var(--v) * 100%), var(--surface)); font-variant-numeric: tabular-nums; }
.heat td.hi { color: #fff; }
.sortbtn { all: unset; cursor: pointer; font-weight: 600; color: var(--ink); }
.sortbtn:hover, .sortbtn:focus-visible { text-decoration: underline; }
th[aria-sort=ascending] .sortbtn::after { content: " ▲"; font-size: 10px; } th[aria-sort=descending] .sortbtn::after { content: " ▼"; font-size: 10px; }
.filters { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 8px; font-size: 13px; color: var(--ink2); }
select { font: inherit; padding: 4px 8px; background: var(--surface); color: var(--ink); border: 1px solid var(--axis); border-radius: 6px; }
details.run { border-top: 1px solid var(--grid); padding: 8px 0; }
details.run > summary { cursor: pointer; }
.rm { font-weight: 600; }
.run-body { padding: 8px 0 8px 22px; }
pre { background: var(--page); border: 1px solid var(--border); border-radius: 8px; padding: 10px; overflow: auto; max-height: 360px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.err { color: var(--ink); background: var(--page); border-left: 3px solid var(--crit); padding: 6px 10px; }
.errs { color: var(--ink2); font-size: 13px; margin: 4px 0; }
.checks td { border-bottom: 1px solid var(--grid); white-space: normal; }
.attempts { padding-left: 20px; }
footer ul { padding-left: 20px; }
code { background: var(--page); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
#tip { position: fixed; z-index: 10; max-width: 340px; background: var(--ink); color: var(--surface); padding: 6px 10px; border-radius: 6px; font-size: 12.5px; pointer-events: none; }
[hidden] { display: none !important; }
`;

// Plain string (no template literal) so no escaping surprises.
const CLIENT_JS = [
  '(function () {',
  '  var tip = document.getElementById("tip");',
  '  function show(el) {',
  '    tip.textContent = el.getAttribute("data-tip");',
  '    tip.hidden = false;',
  '    var r = el.getBoundingClientRect();',
  '    var x = Math.min(Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);',
  '    var y = r.top - tip.offsetHeight - 8;',
  '    if (y < 8) y = r.bottom + 8;',
  '    tip.style.left = x + "px"; tip.style.top = y + "px";',
  '  }',
  '  function hide() { tip.hidden = true; }',
  '  function target(e) { return e.target.closest ? e.target.closest("[data-tip]") : null; }',
  '  document.addEventListener("pointerover", function (e) { var t = target(e); if (t) show(t); });',
  '  document.addEventListener("pointerout", function (e) { if (target(e)) hide(); });',
  '  document.addEventListener("focusin", function (e) { var t = target(e); if (t) show(t); });',
  '  document.addEventListener("focusout", hide);',
  '  document.addEventListener("keydown", function (e) { if (e.key === "Escape") hide(); });',
  '',
  '  var table = document.getElementById("stats");',
  '  if (table) {',
  '    var heads = table.querySelectorAll("th[scope=col]");',
  '    Array.prototype.forEach.call(heads, function (th, col) {',
  '      th.querySelector("button").addEventListener("click", function () {',
  '        var asc = th.getAttribute("aria-sort") !== "ascending";',
  '        Array.prototype.forEach.call(heads, function (h) { h.removeAttribute("aria-sort"); });',
  '        th.setAttribute("aria-sort", asc ? "ascending" : "descending");',
  '        var body = table.tBodies[0];',
  '        var rows = Array.prototype.slice.call(body.rows);',
  '        rows.sort(function (a, b) {',
  '          var x = a.cells[col].getAttribute("data-sort"), y = b.cells[col].getAttribute("data-sort");',
  '          var nx = parseFloat(x), ny = parseFloat(y);',
  '          var c = (!isNaN(nx) && !isNaN(ny) && String(nx) === x && String(ny) === y) ? nx - ny : x.localeCompare(y);',
  '          return asc ? c : -c;',
  '        });',
  '        rows.forEach(function (r) { body.appendChild(r); });',
  '      });',
  '    });',
  '  }',
  '',
  '  var runs = Array.prototype.slice.call(document.querySelectorAll("details.run"));',
  '  var fm = document.getElementById("f-model"), ft = document.getElementById("f-task"), fs = document.getElementById("f-status");',
  '  var count = document.getElementById("run-count");',
  '  function filter() {',
  '    var shown = 0;',
  '    runs.forEach(function (r) {',
  '      var ok = (!fm.value || r.dataset.model === fm.value) && (!ft.value || r.dataset.task === ft.value) && (!fs.value || r.dataset.status === fs.value);',
  '      r.hidden = !ok; if (ok) shown++;',
  '    });',
  '    count.textContent = "Showing " + shown + " of " + runs.length + " runs.";',
  '  }',
  '  if (fm) { [fm, ft, fs].forEach(function (s) { s.addEventListener("change", filter); }); filter(); }',
  '})();',
].join('\n');
