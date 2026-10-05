import './helpers/setup';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';
import {checkCode} from '../../src/llm/codeCheck';
import {toRunnable} from '../../src/llm/codeCheck';
import {TASKS, evaluate} from '../tasks';
import type {ResultsFile, RunResult} from '../types';
import {withBlocklyScoping} from './helpers/scoping';

/**
 * Replays the programs models really wrote, from the benchmark reports saved
 * under reports/ (git-ignored, so only present on the machine that ran them).
 * Every test skips cleanly when there are no code-format reports. The slow
 * scoping replay only runs with FULL=1.
 */
const reportsDir = path.resolve(import.meta.dirname, '../../reports');

function codeReports(): Array<{name: string; results: RunResult[]}> {
  if (!fs.existsSync(reportsDir)) return [];
  const out: Array<{name: string; results: RunResult[]}> = [];
  for (const name of fs.readdirSync(reportsDir).sort()) {
    const file = path.join(reportsDir, name, 'results.json');
    if (name === 'sample' || !fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as ResultsFile;
    if (data.meta.replyFormatMode === 'code') out.push({name, results: data.results});
  }
  return out;
}

const reports = codeReports();
const programs = reports.flatMap((r) =>
  r.results
    .filter((x) => x.program ?? x.code)
    .map((x) => ({report: r.name, run: x, code: (x.program ?? x.code) as string})),
);
const skip = programs.length === 0 ? 'no code-format reports in reports/' : false;

describe('replay: programs real models wrote, through the current checker', {skip}, () => {
  it('rejects a correct program only for the recursion rule (no other false positives)', () => {
    const offenders: string[] = [];
    for (const {report, run, code} of programs) {
      if (run.status !== 'correct') continue;
      const keys = new Set(checkCode(code).violations.map((v) => v.key));
      keys.delete('recursive-local');
      if (keys.size > 0) offenders.push(`${report} ${run.model} ${run.taskId} #${run.trial}: ${[...keys].join(',')}`);
    }
    assert.deepEqual(offenders, []);
  });

  it('rejects every recursive program that keeps locals, so none can reach the translator', () => {
    for (const {run, code} of programs) {
      const recursive = checkCode(code).violations.some((v) => v.key === 'recursive-local');
      if (/mergeSort\(mergeSort|merge\(mergeSort/.test(code)) assert.ok(recursive, `${run.model} ${run.taskId}`);
    }
  });

  it('flags the 0-based text indexing that made the first text probe go wrong', () => {
    const wrongVowels = programs.filter((p) => p.run.taskId === 'vowels' && p.run.status === 'wrong' && /\[i - 1\]/.test(p.code));
    for (const {code} of wrongVowels) assert.ok(checkCode(code).violations.some((v) => v.key === 'index-before-1'));
  });
});

describe('replay: translated-scoping fidelity of the real programs (FULL=1, takes a minute or two)', {skip: skip || (process.env.FULL ? false : 'set FULL=1 to run')}, () => {
  it('every correct program stays correct with Blockly scoping once variables are renamed per function', () => {
    // Global variables are slow, so give the speed check far more time than the 3 s it gets for local variables.
    let checked = 0;
    const failures: string[] = [];
    let unrenamedFailures = 0;
    for (const {report, run, code} of programs) {
      if (run.status !== 'correct' || !checkCode(code).ok) continue;
      const base = TASKS.find((t) => t.id === run.taskId)!;
      const task = base.perf ? {...base, perf: {...base.perf, timeoutMs: 60_000}} : base;
      const grade = (source: string) => evaluate(task, toRunnable(source), new Set(), {dialect: true}).checks.every((c) => c.passed);
      checked++;
      if (!grade(withBlocklyScoping(code, {rename: false}))) unrenamedFailures++;
      if (!grade(withBlocklyScoping(code, {rename: true}))) failures.push(`${report} ${run.model} ${run.taskId} #${run.trial}`);
    }
    assert.ok(checked > 0);
    assert.deepEqual(failures, []);
    // Documents why the translator must rename: some programs break without it.
    assert.ok(unrenamedFailures > 0, `expected some programs to break without renaming (checked ${checked})`);
  });
});
