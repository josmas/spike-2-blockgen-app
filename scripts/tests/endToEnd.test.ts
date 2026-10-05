import './helpers/setup';
import assert from 'node:assert/strict';
import {afterEach, describe, it} from 'node:test';
import {replyFormatFor} from '../../src/config';
import {generate} from '../../src/generate';
import type {AttemptTrace} from '../../src/generate';
import {appendResponse, functionNames} from '../../src/append';
import {EXAMPLES} from '../../src/llm/examples';
import {formatFlat, nestedToFlat} from '../../src/llm/flat';
import type {ModelResponse} from '../../src/llm/parse';
import {classify} from '../classify';
import {newWorkspace} from './helpers/blockly';
import {installFakeOpenRouter} from './helpers/fakeOpenRouter';
import type {FakeOpenRouter, FakeReply, FakeRequest} from './helpers/fakeOpenRouter';
import {BUBBLE_SORT} from './helpers/fixtures';
import {runGenerated} from './helpers/sandbox';
import {javascriptGenerator} from 'blockly/javascript';

const isEven = EXAMPLES[0].response as unknown as ModelResponse;
const flatIsEven = formatFlat(nestedToFlat(isEven));
const codeReply = (code: string, unsupported: string[] = []) => JSON.stringify({summary: 'a program', code, unsupported});

let fake: FakeOpenRouter | undefined;
afterEach(() => fake?.restore());

/** Runs generate() against a fake that answers from `replies` in order (the last one repeats). */
async function run(model: string, replies: FakeReply[], options: {format?: 'nested' | 'flat' | 'code'; ws?: ReturnType<typeof newWorkspace>} = {}) {
  let i = 0;
  fake = installFakeOpenRouter((_req: FakeRequest) => replies[Math.min(i++, replies.length - 1)]);
  const ws = options.ws ?? newWorkspace();
  const traces: AttemptTrace[] = [];
  let summary: string | null = null;
  let error: string | null = null;
  try {
    summary = await generate('a request', 'key', ws, () => {}, {model, replyFormat: options.format, onAttempt: (t) => traces.push(t)});
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return {ws, traces, summary, error, requests: fake.requests};
}

describe('generate(): flat format (opt-in)', () => {
  it('accepts a correct reply on the first attempt, builds the blocks, and sends the flat schema', async () => {
    const r = await run('z-ai/glm-5.3-flash', [{text: flatIsEven}], {format: 'flat'});
    assert.deepEqual(r.traces.map((t) => t.outcome), ['accepted']);
    assert.equal(r.requests[0].format, 'flat');
    assert.equal(r.requests[0].body.response_format.json_schema.name, 'blockly_flat_blocks');
    assert.equal(runGenerated(javascriptGenerator.workspaceToCode(r.ws)).output[0], 'isEven(4) = true');
  });

  it('rejects a wiring mistake with a message naming the block, then recovers on the retry', async () => {
    const bad = JSON.parse(flatIsEven);
    bad.blocks[3].parent = 'b99';
    const r = await run('z-ai/glm-5.3-flash', [{text: JSON.stringify(bad)}, {text: flatIsEven}], {format: 'flat'});
    assert.deepEqual(r.traces.map((t) => t.outcome), ['rejected', 'accepted']);
    assert.match(r.traces[0].errors[0], /Problem with block "b4": its parent "b99" does not exist/);
    const retryMessage = r.requests[1].body.messages.at(-1).content as string;
    assert.ok(retryMessage.includes('b99') && retryMessage.includes('Reminder: list every block exactly once'));
  });

  it('calls a function that already exists, and tells the model about it with its parameters', async () => {
    const ws = newWorkspace();
    appendResponse(ws, JSON.parse(JSON.stringify(isEven)));
    const call = formatFlat({
      summary: 'call it',
      blocks: [
        {id: 'c1', type: 'add_text', parent: '', slot: '', name: '', params: [], fields: []},
        {id: 'c2', type: 'text_join', parent: 'c1', slot: 'TEXT', name: '', params: [], fields: []},
        {id: 'c3', type: 'text', parent: 'c2', slot: 'ADD0', name: '', params: [], fields: [{name: 'TEXT', value: 'isEven(10) = '}]},
        {id: 'c4', type: 'procedures_callreturn', parent: 'c2', slot: 'ADD1', name: 'isEven', params: [], fields: []},
        {id: 'c5', type: 'math_number', parent: 'c4', slot: 'ARG0', name: '', params: [], fields: [{name: 'NUM', value: '10'}]},
      ],
    });
    const r = await run('z-ai/glm-5.3-flash', [{text: call}], {ws, format: 'flat'});
    assert.deepEqual(r.traces.map((t) => t.outcome), ['accepted']);
    assert.match(r.requests[0].body.messages[1].content, /Functions already in the workspace \(do not redefine\): isEven\(n\)/);
  });
});

describe('generate(): the default format per model', () => {
  it('Anthropic models get nested; every other model gets code', () => {
    assert.equal(replyFormatFor('anthropic/claude-haiku-4.5'), 'nested');
    for (const model of ['openai/gpt-5-mini', 'deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.3-flash', 'google/gemini-3-flash-preview']) {
      assert.equal(replyFormatFor(model), 'code', model);
    }
  });
  it('with no format named, a non-Anthropic model is asked for code and its blocks are built', async () => {
    const r = await run('z-ai/glm-5.3-flash', [{text: codeReply(BUBBLE_SORT)}]);
    assert.equal(r.requests[0].format, 'code');
    assert.deepEqual(r.traces.map((t) => t.outcome), ['accepted']);
    assert.deepEqual(functionNames(r.ws), ['bubbleSort']);
  });
});

describe('generate(): nested format (Anthropic models keep it)', () => {
  it('uses the nested prompt and sends no response_format', async () => {
    const r = await run('anthropic/claude-haiku-4.5', [{text: JSON.stringify(isEven)}]);
    assert.deepEqual(r.traces.map((t) => t.outcome), ['accepted']);
    assert.equal(r.requests[0].format, 'nested');
    assert.equal(r.requests[0].body.response_format, undefined);
  });
});

describe('generate(): code format (checked, translated and built into blocks)', () => {
  it('accepts a program inside the dialect and leaves the workspace untouched', async () => {
    const r = await run('openai/gpt-5-mini', [{text: codeReply(BUBBLE_SORT)}], {format: 'code'});
    assert.deepEqual(r.traces.map((t) => t.outcome), ['accepted']);
    assert.equal(r.requests[0].format, 'code');
    assert.equal(r.requests[0].body.response_format.json_schema.name, 'blockly_code_program');
    assert.equal(r.traces[0].code?.code, BUBBLE_SORT);
    assert.ok(r.ws.getAllBlocks(false).length > 10);
    assert.deepEqual(functionNames(r.ws), ['bubbleSort']);
    assert.equal(r.summary, 'a program');
    const exec = runGenerated(javascriptGenerator.workspaceToCode(r.ws));
    assert.deepEqual(exec.output, ['sorted = 1,2,3']);
  });

  it('turns a problem the translator finds into a retry message about the code, by line', async () => {
    const bad = 'function f(x) { print(x); }\nprint(f(1));';
    const r = await run('openai/gpt-5-mini', [{text: codeReply(bad)}, {text: codeReply(BUBBLE_SORT)}], {format: 'code'});
    assert.deepEqual(r.traces.map((t) => t.outcome), ['rejected', 'accepted']);
    assert.match(r.traces[0].errors[0], /^Line 2: "f" does not return a value/);
    assert.equal(classify(r.traces[0].errors[0]), 'untranslatable');
    assert.match(r.requests[1].body.messages.at(-1).content, /Line 2: "f" does not return a value/);
  });

  it('calls a function that is already in the workspace with the right block', async () => {
    const first = await run('openai/gpt-5-mini', [{text: codeReply('function twice(x) { return x * 2; }')}], {format: 'code'});
    assert.deepEqual(functionNames(first.ws), ['twice']);
    const second = await run('openai/gpt-5-mini', [{text: codeReply('print(twice(4));')}], {format: 'code', ws: first.ws});
    assert.deepEqual(second.traces.map((t) => t.outcome), ['accepted']);
    assert.deepEqual(runGenerated(javascriptGenerator.workspaceToCode(second.ws)).output, ['8']);
  });

  it('rejects syntax outside the dialect with line numbers, records the constructs, and asks for a rewrite', async () => {
    const r = await run('openai/gpt-5-mini', [{text: codeReply('const f = (x) => x;\nconsole.log(`${f(1)}`);')}, {text: codeReply(BUBBLE_SORT)}], {format: 'code'});
    assert.deepEqual(r.traces.map((t) => t.outcome), ['rejected', 'accepted']);
    assert.ok(r.traces[0].errors.every((e) => /^Line \d+: /.test(e)));
    assert.ok(Object.keys(r.traces[0].code!.constructs).some((k) => k === 'ArrowFunctionExpression'));
    assert.match(r.requests[1].body.messages.at(-1).content, /Rewrite the program using only the dialect/);
  });

  it('keeps what the model says it could not express', async () => {
    const r = await run('openai/gpt-5-mini', [{text: codeReply(BUBBLE_SORT, ['no dictionary type'])}], {format: 'code'});
    assert.deepEqual(r.traces[0].code?.unsupportedNotes, ['no dictionary type']);
  });
});

describe('generate(): failures', () => {
  it('survives a reply that is not JSON, then recovers', async () => {
    const r = await run('z-ai/glm-5.3-flash', [{text: 'Sure, here you go'}, {text: flatIsEven}], {format: 'flat'});
    assert.deepEqual(r.traces.map((t) => t.outcome), ['rejected', 'accepted']);
    assert.match(r.traces[0].errors[0], /not valid JSON/);
  });

  it('gives up after three attempts and leaves the workspace untouched', async () => {
    const r = await run('z-ai/glm-5.3-flash', [{text: 'x'}, {text: 'y'}, {text: 'z'}], {format: 'flat'});
    assert.equal(r.traces.length, 3);
    assert.match(r.error ?? '', /Gave up after 3 attempts/);
    assert.equal(r.ws.getAllBlocks(false).length, 0);
  });

  it('does not retry when the model runs out of tokens before answering', async () => {
    const r = await run('z-ai/glm-5.3-flash', [{text: '', finishReason: 'length'}], {format: 'flat'});
    assert.match(r.error ?? '', /ran out of tokens/);
    assert.equal(r.requests.length, 1);
    assert.deepEqual(r.traces.map((t) => t.outcome), ['request-error']);
  });

  it('reports an HTTP error and keeps the cost information on the failed attempt', async () => {
    const r = await run('z-ai/glm-5.3-flash', [{status: 401, body: '{"error":"bad key"}'}], {format: 'flat'});
    assert.match(r.error ?? '', /OpenRouter 401/);
    assert.equal(r.traces[0].outcome, 'request-error');
  });
});
