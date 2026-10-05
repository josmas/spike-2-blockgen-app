import './helpers/setup';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {describe, it} from 'node:test';
import {checkCode} from '../../src/llm/codeCheck';
import {messagesAboutCode, translateCode} from '../../src/llm/codeToBlocks';
import {buildFromFlat} from '../../src/llm/flat';
import {validate} from '../../src/llm/validate';
import {TASKS, evaluate} from '../tasks';
import type {ResultsFile, RunResult} from '../types';
import {generateJs, newWorkspace} from './helpers/blockly';

/**
 * Fidelity replay of the translator: every program a real model wrote (from the
 * code-format reports under reports/, git-ignored) that passes the checker must
 * translate, build and validate; with FULL=1 the benchmark's task checks run on
 * the JavaScript Blockly generates and must pass wherever the program as
 * written passed. Skips when there are no reports.
 */
const reportsDir = path.resolve(import.meta.dirname, '../../reports');

function programs(): Array<{report: string; run: RunResult; code: string}> {
  if (!fs.existsSync(reportsDir)) return [];
  const out: Array<{report: string; run: RunResult; code: string}> = [];
  for (const name of fs.readdirSync(reportsDir).sort()) {
    const file = path.join(reportsDir, name, 'results.json');
    if (name === 'sample' || !fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as ResultsFile;
    if (data.meta.replyFormatMode !== 'code') continue;
    for (const run of data.results) {
      const code = run.program ?? run.code; // older reports keep the program in `code`
      if (code) out.push({report: name, run, code});
    }
  }
  return out.filter((p) => checkCode(p.code).ok);
}

const all = programs();
const skip = all.length === 0 ? 'no code-format reports in reports/' : false;
const label = (p: (typeof all)[number]) => `${p.report} ${p.run.model} ${p.run.taskId} #${p.run.trial}`;

function toBlocks(code: string) {
  const {blocks, lineOf} = translateCode(code);
  const built = buildFromFlat({summary: '', blocks});
  assert.deepEqual(built.errors, []);
  const problems = messagesAboutCode(validate(built.response!, newWorkspace()), lineOf);
  return {response: built.response!, blocks, problems};
}

describe('translator replay: every checker-passing program a real model wrote', {skip}, () => {
  it('translates, builds and validates', () => {
    const failures: string[] = [];
    for (const p of all) {
      try {
        const {problems} = toBlocks(p.code);
        if (problems.length) failures.push(`${label(p)}: ${problems.join(' | ')}`);
      } catch (e) {
        failures.push(`${label(p)}: ${(e as Error).message}`);
      }
    }
    assert.deepEqual(failures, []);
  });
});

describe('translator replay: task checks on the blocks\' generated JavaScript (FULL=1)', {skip: skip || (process.env.FULL ? false : 'set FULL=1 to run')}, () => {
  it('every program that passed as written passes as blocks', () => {
    const losses: string[] = [];
    let checked = 0;
    for (const p of all) {
      if (p.run.status !== 'correct') continue;
      const task = TASKS.find((t) => t.id === p.run.taskId)!;
      const {response, blocks} = toBlocks(p.code);
      const result = evaluate(task, generateJs(response), new Set(blocks.map((b) => b.type)));
      checked++;
      const failed = result.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
      if (failed.length) losses.push(`${label(p)}: ${failed.join('; ')}`);
    }
    assert.ok(checked > 0);
    assert.deepEqual(losses, []);
  });
});
