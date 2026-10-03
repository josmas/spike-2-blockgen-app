/**
 * Benchmark: how well does each model do the app's job?
 *
 * Calls the app's own generate() (same prompt, parser, validation and retries)
 * with the text a user would type, then runs the accepted program and checks
 * it. Writes results.json and report.html under reports/<timestamp>/.
 *
 *   npm run benchmark -- --dry-run            show the plan and a cost estimate
 *   npm run benchmark                          run it (asks before spending)
 *   npm run benchmark -- --yes --cap 1.5       skip the question, lower the cap
 *   npm run benchmark -- --report-only reports/<dir>
 *
 * Needs OPENROUTER_API_KEY in the environment (not for --dry-run).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import {parseArgs} from 'node:util';
import * as Blockly from 'blockly/core';
import {javascriptGenerator} from 'blockly/javascript';
import {replyFormatFor, responseFormatFor} from '../src/config';
import type {ReplyFormat, ResponseFormat} from '../src/config';
import {generate} from '../src/generate';
import type {AttemptTrace} from '../src/generate';
import {setLogSink} from '../src/log';
import type {ChatStats} from '../src/llm/openrouter';
import {buildSystemPromptFor, buildUserPrompt} from '../src/llm/prompts';
import {registerBlocks} from '../src/register';
import {classify} from './classify';
import {estimateCost, fetchModelInfo} from './pricing';
import type {ModelInfo} from './pricing';
import {buildReport} from './report';
import {summarize, usd} from './summary';
import {TASKS, evaluate} from './tasks';
import type {Task} from './tasks';
import type {
  AttemptRecord,
  FailureCategory,
  ResultsFile,
  RunMeta,
  RunResult,
} from './types';

// The reference model (claude-haiku-4.5) is first so every report has a
// known-good row to compare against. Delete it to save a little money.
const DEFAULT_MODELS = [
  'anthropic/claude-haiku-4.5',
  'openai/gpt-5-mini',
  'google/gemini-3-flash-preview',
  'google/gemini-2.5-flash',
  'z-ai/glm-5.3-flash',
  'deepseek/deepseek-v4.1-flash',
  'mistralai/mistral-medium-3.1',
  'moonshotai/kimi-k2.7-code',
  'qwen/qwen3.5-35b-a3b',
  'stepfun/step-3.5-flash',
  'xiaomi/mimo-v2.6-flash',
];

const MAX_STORED_REPLY_CHARS = 200_000;

/** Thrown from the attempt callback to stop a run once the cap is spent. */
class CapReached extends Error {}

interface Job {
  model: string;
  task: Task;
  trial: number;
}

// ---- command line ---------------------------------------------------------

const {values: args} = parseArgs({
  options: {
    models: {type: 'string'},
    tasks: {type: 'string'},
    trials: {type: 'string', default: '3'},
    cap: {type: 'string', default: '3'},
    concurrency: {type: 'string', default: '4'},
    format: {type: 'string', default: 'auto'},
    'reply-format': {type: 'string', default: 'auto'},
    'strict-routing': {type: 'boolean', default: false},
    'dry-run': {type: 'boolean', default: false},
    yes: {type: 'boolean', default: false},
    out: {type: 'string'},
    'report-only': {type: 'string'},
  },
});

async function main(): Promise<void> {
  if (args['report-only']) return reportOnly(args['report-only']);

  const models = args.models ? args.models.split(',').map((s) => s.trim()) : DEFAULT_MODELS;
  const taskIds = args.tasks ? args.tasks.split(',').map((s) => s.trim()) : TASKS.map((t) => t.id);
  const tasks = taskIds.map((id) => {
    const task = TASKS.find((t) => t.id === id);
    if (!task) throw new Error(`Unknown task "${id}". Known: ${TASKS.map((t) => t.id).join(', ')}`);
    return task;
  });
  const trials = Number(args.trials);
  const capUsd = Number(args.cap);
  const concurrency = Math.max(1, Number(args.concurrency));
  const formatArg = args.format as string;
  if (!['auto', 'none', 'json_object', 'json_schema'].includes(formatArg)) {
    throw new Error(`--format must be auto, none, json_object or json_schema (got "${formatArg}")`);
  }
  const replyArg = args['reply-format'] as string;
  if (!['auto', 'nested', 'flat'].includes(replyArg)) {
    throw new Error(`--reply-format must be auto, nested or flat (got "${replyArg}")`);
  }
  const strictRouting = Boolean(args['strict-routing']);
  const formatFor = (model: string): ResponseFormat =>
    formatArg === 'auto' ? responseFormatFor(model) : (formatArg as ResponseFormat);
  const replyFor = (model: string): ReplyFormat =>
    replyArg === 'auto' ? replyFormatFor(model) : (replyArg as ReplyFormat);

  // ---- plan and estimate --------------------------------------------------
  const info = await fetchModelInfo();
  const unknown = models.filter((m) => !info.has(m));
  const totalRuns = models.length * tasks.length * trials;
  const promptTokensFor = (model: string): number =>
    Math.round(
      (buildSystemPromptFor(replyFor(model)).length + buildUserPrompt(tasks[0].prompt, []).length) / 3.5,
    );

  console.log(`\nPlan: ${models.length} models x ${tasks.length} tasks x ${trials} trials = ${totalRuns} runs`);
  console.log(`Tasks: ${tasks.map((t) => `"${t.prompt}"`).join(', ')}`);
  console.log(`Response format: ${formatArg}; reply format: ${replyArg}${strictRouting ? '; strict routing' : ''}; concurrency ${concurrency}; cap ${usd(capUsd, 2)}`);
  console.log(`Prompts are about ${promptTokensFor(models[0]).toLocaleString('en-US')} tokens per request.\n`);

  let expected = 0;
  let worst = 0;
  const rows: string[][] = [['model', '$/M in', '$/M out', 'context', 'format', 'reply', 'structured?', 'reasoning?', 'expected', 'worst case']];
  for (const model of models) {
    const m = info.get(model);
    if (!m) {
      rows.push([model, '?', '?', '?', formatFor(model), replyFor(model), 'MODEL NOT FOUND', '', '', '']);
      continue;
    }
    const runs = tasks.length * trials;
    // Expected: 1.5 attempts, 4k output tokens each. Worst: 3 attempts that
    // each use the whole output budget and a growing prompt.
    const promptTokens = promptTokensFor(model);
    const e = runs * 1.5 * estimateCost(m, promptTokens, 4000);
    const w = runs * estimateCost(m, promptTokens * 3 + 6000, 3 * 16000);
    expected += e;
    worst += w;
    rows.push([
      model,
      (m.promptPrice * 1e6).toFixed(2),
      (m.completionPrice * 1e6).toFixed(2),
      m.contextLength ? `${Math.round(m.contextLength / 1000)}k` : '?',
      formatFor(model),
      replyFor(model),
      m.supportsStructuredOutput ? 'yes' : 'no',
      m.supportsReasoning ? 'yes' : 'no',
      usd(e, 3),
      usd(w, 2),
    ]);
  }
  printTable(rows);
  console.log(`\nEstimated spend: about ${usd(expected, 2)} expected, ${usd(worst, 2)} if every attempt used its full output budget.`);
  console.log(`The cap of ${usd(capUsd, 2)} stops the run when reached (in-flight requests may overshoot slightly).`);
  console.log('Estimates assume 4,000 output tokens per attempt; reasoning models often use more.\n');
  if (unknown.length) {
    throw new Error(`Not on OpenRouter: ${unknown.join(', ')}. Fix the slug or remove it.`);
  }
  if (args['dry-run']) return;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in the environment first.');
  if (!args.yes) {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    const answer = await rl.question(`Run ${totalRuns} runs now? [y/N] `);
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Cancelled.');
      return;
    }
  }

  // ---- run ----------------------------------------------------------------
  const outDir = args.out ?? path.join('reports', timestamp());
  fs.mkdirSync(outDir, {recursive: true});
  const meta: RunMeta = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    models,
    taskIds: tasks.map((t) => t.id),
    trials,
    responseFormatMode: formatArg,
    replyFormatMode: replyArg,
    strictRouting,
    capUsd,
    spentUsd: 0,
    stoppedEarly: false,
    notes: [],
  };
  const results: RunResult[] = [];
  const save = () => {
    const file: ResultsFile = {meta, results};
    const target = path.join(outDir, 'results.json');
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(file));
    fs.renameSync(`${target}.tmp`, target);
  };

  // The app logs and warns a lot; both are noise here.
  setLogSink(() => {});
  console.warn = () => {};
  registerBlocks();

  // Trial-major order, so if the cap hits, every model has had a similar
  // number of runs instead of the last models getting none.
  const queue: Job[] = [];
  for (let trial = 1; trial <= trials; trial++) {
    for (const task of tasks) {
      for (const model of models) queue.push({model, task, trial});
    }
  }

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) process.exit(1);
    stopping = true;
    meta.stoppedEarly = true;
    meta.notes.push('Stopped with Ctrl-C.');
    console.log('\nStopping after the requests in flight finish. Press Ctrl-C again to quit now.');
  });

  const running = new Set<string>();
  const spend = {usd: 0};
  let done = 0;

  const takeJob = (): Job | undefined => {
    const i = queue.findIndex((j) => !running.has(j.model));
    return i === -1 ? undefined : queue.splice(i, 1)[0];
  };

  const worker = async (): Promise<void> => {
    while (!stopping && queue.length > 0) {
      if (spend.usd >= capUsd) {
        stopping = true;
        meta.stoppedEarly = true;
        meta.notes.push(`Spending cap of ${usd(capUsd, 2)} reached.`);
        console.log(`\nSpending cap of ${usd(capUsd, 2)} reached; not starting new runs.`);
        break;
      }
      const job = takeJob();
      if (!job) {
        // Everything left belongs to a model that is busy; wait a moment.
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      running.add(job.model);
      try {
        const result = await runOne(job, apiKey, formatFor(job.model), replyFor(job.model), strictRouting, info.get(job.model), capUsd, spend);
        results.push(result);
        meta.spentUsd = spend.usd;
        save();
        done++;
        console.log(
          `${String(done).padStart(3)}/${totalRuns}  ${result.status.padEnd(7)} ${job.model.padEnd(32)} ${job.task.id.padEnd(7)} #${job.trial}  ` +
            `${result.attempts.length} att  ${(result.durationMs / 1000).toFixed(1).padStart(5)}s  ${usd(result.cost).padStart(8)}  total ${usd(spend.usd, 3)}`,
        );
      } finally {
        running.delete(job.model);
      }
    }
  };

  await Promise.all(Array.from({length: concurrency}, worker));

  meta.finishedAt = new Date().toISOString();
  meta.spentUsd = spend.usd;
  const unfinished = queue.length;
  if (unfinished > 0) {
    meta.stoppedEarly = true;
    if (!meta.notes.length) meta.notes.push(`${unfinished} planned runs were not started.`);
  }
  save();
  fs.writeFileSync(path.join(outDir, 'report.html'), buildReport({meta, results}));

  printSummary(results);
  console.log(`\nSpent ${usd(spend.usd, 3)} of ${usd(capUsd, 2)}.`);
  console.log(`Report:  ${path.resolve(outDir, 'report.html')}`);
  console.log(`Data:    ${path.resolve(outDir, 'results.json')}`);
}

// ---- one run --------------------------------------------------------------

async function runOne(
  job: Job,
  apiKey: string,
  responseFormat: ResponseFormat,
  replyFormat: ReplyFormat,
  strictRouting: boolean,
  info: ModelInfo | undefined,
  capUsd: number,
  spend: {usd: number},
): Promise<RunResult> {
  const {model, task, trial} = job;
  const ws = new Blockly.Workspace();
  const attempts: AttemptRecord[] = [];
  const providers: string[] = [];
  let cost = 0;
  let costEstimated = false;
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let summary: string | null = null;
  let finalError: string | null = null;
  let aborted = false;
  const started = Date.now();
  const startedAt = new Date(started).toISOString();

  const attemptCost = (stats: ChatStats | null): number => {
    if (!stats) return 0;
    const u = stats.usage;
    if (u) {
      promptTokens += u.promptTokens ?? 0;
      completionTokens += u.completionTokens ?? 0;
      reasoningTokens += u.reasoningTokens ?? 0;
      if (u.cost !== null) return u.cost;
    }
    // A request that never produced any data (HTTP error, timeout before the
    // first chunk) was not billed.
    if (!u && stats.firstDataMs === null) return 0;
    // OpenRouter did not report a cost: estimate it from what we know.
    costEstimated = true;
    if (!info) return 0;
    const outTokens = u?.completionTokens ?? Math.round((stats.reasoningChars + stats.contentChars) / 3.5);
    const inTokens = u?.promptTokens ?? Math.round(buildSystemPromptFor(replyFormat).length / 3.5);
    if (!u) completionTokens += outTokens;
    return estimateCost(info, inTokens, outTokens);
  };

  const onAttempt = (t: AttemptTrace): void => {
    const categories: FailureCategory[] = [...new Set(t.errors.map(classify))];
    attempts.push({
      attempt: t.attempt,
      temperature: t.temperature,
      outcome: t.outcome,
      errors: t.errors,
      categories,
      reply: t.reply === null ? null : t.reply.slice(0, MAX_STORED_REPLY_CHARS),
      replyChars: t.reply?.length ?? 0,
      stats: t.stats,
    });
    if (t.stats?.provider && !providers.includes(t.stats.provider)) providers.push(t.stats.provider);
    const c = attemptCost(t.stats);
    cost += c;
    spend.usd += c;
    // Never throw away an accepted program; only stop before a retry.
    if (t.outcome === 'rejected' && spend.usd >= capUsd) throw new CapReached();
  };

  try {
    summary = await generate(task.prompt, apiKey, ws, () => {}, {
      model,
      responseFormat,
      replyFormat,
      provider: strictRouting ? {require_parameters: true, allow_fallbacks: false} : undefined,
      onAttempt,
    });
  } catch (e) {
    if (e instanceof CapReached) aborted = true;
    else finalError = e instanceof Error ? e.message : String(e);
  }

  const accepted = attempts.find((a) => a.outcome === 'accepted');
  let status: RunResult['status'] = aborted ? 'aborted' : 'failed';
  let code: string | null = null;
  let checks: RunResult['checks'] = [];
  let functionNames: string[] = [];
  let programOutput: string[] = [];
  let blockCount: number | null = null;

  if (accepted) {
    code = javascriptGenerator.workspaceToCode(ws);
    const blocks = ws.getAllBlocks(false);
    blockCount = blocks.length;
    const evaluation = evaluate(task, code, new Set(blocks.map((b) => b.type)));
    checks = evaluation.checks;
    functionNames = evaluation.functionNames;
    programOutput = evaluation.programOutput;
    status = checks.every((c) => c.passed) ? 'correct' : 'wrong';
  }
  ws.dispose();

  return {
    id: `${model}|${task.id}|${trial}`,
    model,
    taskId: task.id,
    trial,
    responseFormat,
    replyFormat,
    providers,
    startedAt,
    durationMs: Date.now() - started,
    status,
    attempts,
    acceptedOnAttempt: accepted?.attempt ?? null,
    finalError: status === 'correct' || status === 'wrong' ? null : finalError,
    summary,
    code,
    functionNames,
    blockCount,
    checks,
    programOutput,
    cost,
    costEstimated,
    promptTokens,
    completionTokens,
    reasoningTokens,
  };
}

// ---- output helpers -------------------------------------------------------

function reportOnly(dir: string): void {
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')) as ResultsFile;
  fs.writeFileSync(path.join(dir, 'report.html'), buildReport(file));
  console.log(`Wrote ${path.resolve(dir, 'report.html')}`);
}

function printSummary(results: RunResult[]): void {
  const rows: string[][] = [['model', 'correct', 'first try', 'wrong', 'failed', 'median s', '$/run', 'total $']];
  for (const s of summarize(results)) {
    rows.push([
      s.model,
      `${s.correct}/${s.runs}`,
      `${s.firstAttemptAccepted}/${s.runs}`,
      String(s.wrong),
      String(s.failed),
      s.medianSeconds === null ? 'n/a' : s.medianSeconds.toFixed(1),
      usd(s.meanCost),
      usd(s.totalCost, 3),
    ]);
  }
  console.log('');
  printTable(rows);
}

function printTable(rows: string[][]): void {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  rows.forEach((row, i) => {
    console.log(row.map((cell, j) => cell.padEnd(widths[j])).join('  ').trimEnd());
    if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  });
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
