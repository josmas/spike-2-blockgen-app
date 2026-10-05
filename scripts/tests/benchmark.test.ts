import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, it, before} from 'node:test';
import type {ResultsFile} from '../types';

// These tests run the real benchmark CLI as a child process against a fake
// OpenRouter (helpers/benchmarkStub.ts): no network, no key, no cost.
const root = path.resolve(import.meta.dirname, '../..');

function benchmark(args: string[]) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockgen-bench-'));
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
      '--disable-warning=ExperimentalWarning',
      '--import', './scripts/register.mjs',
      '--import', './scripts/tests/helpers/benchmarkStub.ts',
      'scripts/benchmark.ts',
      ...args,
      '--out', outDir,
    ],
    {cwd: root, encoding: 'utf8', env: {...process.env, OPENROUTER_API_KEY: 'dummy'}, timeout: 120_000},
  );
  const resultsPath = path.join(outDir, 'results.json');
  const file: ResultsFile | null = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : null;
  return {...result, outDir, file};
}

describe('benchmark CLI, end to end against a fake OpenRouter', () => {
  let run: ReturnType<typeof benchmark>;
  before(() => {
    run = benchmark(['--yes', '--models', 'fake/good,fake/retries,fake/broken,fake/down', '--tasks', 'bubble', '--trials', '1', '--reply-format', 'code', '--format', 'none']);
  });

  const result = (model: string) => run.file!.results.find((r) => r.model === model)!;

  it('finishes and writes results.json and report.html', () => {
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.ok(run.file);
    assert.ok(fs.existsSync(path.join(run.outDir, 'report.html')));
    assert.equal(run.file!.results.length, 4);
    assert.equal(run.file!.meta.replyFormatMode, 'code');
  });

  it('grades a correct program as correct, by running it', () => {
    const r = result('fake/good');
    assert.equal(r.status, 'correct');
    assert.equal(r.attempts.length, 1);
    assert.ok(r.checks.some((c) => /sorts correctly/.test(c.name) && c.passed));
  });

  it('grades the blocks\' JavaScript, and keeps the model\'s program and its as-written result beside it', () => {
    const r = result('fake/good');
    assert.match(r.code ?? '', /function bubbleSort\(list\)/);
    assert.ok(!/\bprint\(/.test(r.code ?? ''), 'code is what Blockly generated, not the dialect program');
    assert.match(r.program ?? '', /print\(join\(/);
    assert.equal(r.dialectCorrect, true);
    assert.ok((r.blockCount ?? 0) > 10);
  });

  it('classifies a rejected first attempt as unsupported syntax, then accepts the retry', () => {
    const r = result('fake/retries');
    assert.equal(r.status, 'correct');
    assert.equal(r.attempts.length, 2);
    assert.deepEqual(r.attempts[0].categories, ['unsupported-syntax']);
    assert.ok(Object.keys(r.attempts[0].constructs ?? {}).includes('ArrowFunctionExpression'));
  });

  it('fails a model that never gets inside the dialect after three attempts', () => {
    const r = result('fake/broken');
    assert.equal(r.status, 'failed');
    assert.equal(r.attempts.length, 3);
  });

  it('records an HTTP error as such, and charges nothing for it', () => {
    const r = result('fake/down');
    assert.equal(r.status, 'failed');
    assert.deepEqual(r.attempts[0].categories, ['http-error']);
    assert.equal(r.cost, 0);
  });

  it('adds the costs up (the fake charges $0.001 per answered attempt: 1 + 2 + 3)', () => {
    assert.ok(Math.abs(run.file!.meta.spentUsd - 0.006) < 1e-9, String(run.file!.meta.spentUsd));
  });

  it('shows the constructs models reached for in the report', () => {
    const html = fs.readFileSync(path.join(run.outDir, 'report.html'), 'utf8');
    assert.match(html, /Outside the dialect/);
    assert.match(html, /ArrowFunctionExpression/);
  });

  it('--report-only rebuilds the report from results.json', () => {
    const reportPath = path.join(run.outDir, 'report.html');
    fs.rmSync(reportPath);
    const again = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', './scripts/register.mjs', 'scripts/benchmark.ts', '--report-only', run.outDir], {cwd: root, encoding: 'utf8'});
    assert.equal(again.status, 0, again.stderr);
    assert.ok(fs.existsSync(reportPath));
  });
});

describe('benchmark CLI: planning and the spending cap', () => {
  it('--dry-run prints the plan and an estimate, spends nothing and needs no key', () => {
    const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', './scripts/register.mjs', '--import', './scripts/tests/helpers/benchmarkStub.ts', 'scripts/benchmark.ts', '--dry-run', '--models', 'fake/good,fake/broken', '--tasks', 'bubble,faster', '--trials', '3'], {cwd: root, encoding: 'utf8', env: {...process.env, OPENROUTER_API_KEY: ''}});
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 models x 2 tasks x 3 trials = 12 runs/);
    assert.match(r.stdout, /Estimated spend/);
  });

  it('the default tasks stay the two sorting tasks', () => {
    const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--disable-warning=ExperimentalWarning', '--import', './scripts/register.mjs', '--import', './scripts/tests/helpers/benchmarkStub.ts', 'scripts/benchmark.ts', '--dry-run', '--models', 'fake/good', '--trials', '1'], {cwd: root, encoding: 'utf8'});
    assert.match(r.stdout, /1 models x 2 tasks x 1 trials = 2 runs/);
  });

  it('stops starting new runs once the cap is reached', () => {
    const r = benchmark(['--yes', '--models', 'fake/good', '--tasks', 'bubble', '--trials', '5', '--concurrency', '1', '--cap', '0.0015', '--reply-format', 'code', '--format', 'none']);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.file!.meta.stoppedEarly, true);
    assert.ok(r.file!.results.length < 5 && r.file!.results.length >= 1);
    assert.ok(r.file!.meta.notes.some((n) => /cap/i.test(n)));
  });
});
