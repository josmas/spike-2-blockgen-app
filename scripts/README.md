# Model benchmark

Measures how well each OpenRouter model does the app's job: turn a request like
"a bubble sort function" into a valid Blockly workspace whose code actually works.

It calls the app's own `generate()` (same prompt, parser, validation and retries
as the Generate button), runs the accepted program in a sandbox, checks the
result, and writes an HTML report.

## Quick start

You need Node 24 and an OpenRouter API key. No other install step: the script
runs the app's TypeScript directly.

```sh
export OPENROUTER_API_KEY=sk-or-...

npm run benchmark -- --dry-run   # 1. see the plan and a cost estimate (free, no key needed)
npm run benchmark                # 2. run it; asks "Run N runs now? [y/N]" before spending
```

Open `reports/<timestamp>/report.html` when it finishes.

## What a run does

For every combination of model x task x trial:

1. A fresh, empty headless Blockly workspace is created.
2. `generate(task prompt, ...)` is called, with up to 3 attempts, exactly as in the app.
3. If an attempt is accepted, the JavaScript Blockly generates is executed in a
   `node:vm` sandbox and the task's checks run on it.
4. The run is recorded as one of:
   - **correct**: accepted by the app's validation and passed every check
   - **wrong**: accepted by the app's validation, but a check failed
   - **failed**: no attempt was accepted
   - **aborted**: stopped early by the spending cap (not counted in any total)

Runs go trial by trial across all models, so if the spending cap is hit, every
model has had a similar number of runs.

## Defaults

| Setting | Default | Flag |
| --- | --- | --- |
| Models | the list in `DEFAULT_MODELS` in `benchmark.ts` (11 models, `claude-haiku-4.5` first as the reference) | `--models a,b,c` |
| Tasks | `bubble` ("a bubble sort function"), `faster` ("a sorting function faster than bubble sort"). Also available: `parity` (isOdd, isEven, isDivisible), `zerosum`, and probes for where the code dialect leaks: `palindrome`, `reverse`, `vowels` (text), `factorial`, `fibonacci`, `gcd` (recursion and loops), `fizzbuzz`, `binsearch`, `matrix` (nested lists). Tasks other than the default two run only when named | `--tasks bubble,parity` |
| Trials per model and task | 3 | `--trials N` |
| Spending cap | $3.00 | `--cap USD` |
| Requests in flight | 4 (never more than one per model) | `--concurrency N` |
| Response format | `auto`: what the app uses for that model | `--format auto\|none\|json_object\|json_schema` |
| Reply format | `auto`: nested for Anthropic models, code for everything else (see below); `flat` only when asked for | `--reply-format auto\|nested\|flat\|code` |
| Provider routing | OpenRouter default, like the app | `--strict-routing` |

Other flags:

- `--dry-run`: print the plan, the per-model price table and a cost estimate, then exit. Spends nothing.
- `--yes`: skip the "Run N runs now?" question.
- `--out DIR`: write output to `DIR` instead of `reports/<timestamp>`.
- `--report-only DIR`: rebuild `DIR/report.html` from `DIR/results.json` without running anything.

Arguments after `--` are passed to the script, for example:

```sh
npm run benchmark -- --models openai/gpt-5-mini,z-ai/glm-5.3-flash --trials 5 --cap 1
npm run benchmark -- --tasks bubble --format none --yes
```

## Cost and the cap

`--dry-run` prints two numbers per model:

- **expected**: about 1.5 attempts per run at 4,000 output tokens each
- **worst case**: 3 attempts that each use the full 16,000-token output budget

Reasoning models often use more than 4,000 tokens, so treat "expected" as a
floor. The cap is checked after every attempt: once it is reached, no new run
starts and a run that has just had an attempt rejected is stopped instead of
retrying (marked "aborted"). A run whose attempt was accepted is always kept.
Requests already in flight can overshoot the cap slightly. Real costs come
from OpenRouter's usage report; where a provider doesn't report one, the cost is
estimated from token counts and marked as estimated in the results.

Press Ctrl-C once to stop starting new runs and let the ones in flight finish
(the report is still written). Press it again to quit immediately.

## Output

Written to `reports/<timestamp>/` (git-ignored):

- `report.html`: one self-contained file: outcome by model, time and cost charts,
  a heatmap of why attempts fail, a sortable table of all numbers, and every
  run's attempts, errors, check results and generated code. Light and dark mode.
- `results.json`: the raw data, including each raw model reply (long replies are
  truncated at 200,000 characters). Saved after every run, so an interrupted run
  keeps what finished.

The console also prints a summary table at the end.

## What the checks mean

For both tasks, a run is only **correct** if all of these pass:

- the generated program runs without throwing
- the built-in sort block (`lists_sort`) is not used
- the function that looks like the sort (first function whose name contains
  "sort", otherwise the first function) correctly sorts nine fixed inputs,
  including an empty list, duplicates, negatives and 200 pseudo-random numbers.
  It may return the sorted list or sort the list in place.

The `faster` task adds one more: it must sort 100,000 numbers within 3 seconds.
Bubble, insertion and selection sort cannot do that, so this rules out quadratic
algorithms.

Limits to keep in mind:

- The checks cannot prove *which* algorithm was used. A response can pass the
  `faster` task without being quick sort or merge sort.
- A handful of trials per cell is a small sample. Small differences between
  models are noise.
- The code runs in `node:vm` with a timeout and no access to `require`, `process`
  or the network. That is fine for a local benchmark but is not a security boundary.

## Reply format: nested or flat

The model can describe the workspace in two ways, chosen per model in
`replyFormatFor()` in `src/config.ts` (and overridden here with `--reply-format`):

- **nested**: Blockly's own JSON, with blocks written inside their parents. Large
  models cope with it. Smaller ones often lose count of the closing braces
  (runs of 20 or more) and the reply fails to parse.
- **flat**: a list of blocks, one per line, each saying which block it plugs into
  (`"parent"` and `"slot"`). The app builds the nesting itself, and also works out
  variable ids, function parameters on calls, if/else and item counts, and block
  positions, so the model never writes them. The code is `src/llm/flat.ts`.

Flat replies have their own failure category in the report, "Flat wiring error"
(for example a parent that doesn't exist, or two blocks in one slot). Everything
after the build (validation, type checks, the Blockly dry run, the correctness
checks) is shared by both formats, so results are comparable.

To compare the two on one model, run it twice with the other flag, for example:

```sh
npm run benchmark -- --models openai/gpt-5-mini --tasks bubble --trials 1 --reply-format flat --cap 0.05
```

## Code format

`--reply-format code` asks the model for a small JavaScript program instead of
blocks. The program is checked against a restricted dialect and then **translated
into blocks** (`src/llm/codeToBlocks.ts`), which are validated and appended like the
blocks of the other formats.

- The program must use a restricted dialect, defined in `src/llm/dialect.ts`: `var`,
  `if`, counting `for` loops, `while`, `for...of`, functions, list literals, the
  usual operators, a few `Math` functions, and `print`/`join`. Lists are **1-based**
  (`list[1]` is the first item). The prompt's description of the dialect is generated
  from that same file, so what the model is told matches what is accepted.
- `src/llm/codeCheck.ts` parses the program with `acorn` and rejects anything outside
  the dialect, with a message that has the line number and a suggestion, for example
  `Line 7: ".sort(...)" is not available: implement the sorting yourself with loops.`
  The model gets one retry per message, as with the other formats.
- A program that passes the check is translated into blocks (the mapping is in
  `STAGE2_PLAN.md`, section 7). Each function becomes a definition, counting `for`
  loops become Blockly's "count with" block inside an `if` so an empty range does
  nothing (as in JavaScript), and locals that would clash are renamed because only
  parameters are local in blocks. A few legal programs have no faithful block form
  (for example a call used as a value when the function returns nothing); those are
  sent back to the model as `Line N: ...` messages, category "Not expressible as
  blocks". Errors found later by the validator are reworded as `Line N:` too, because
  the model wrote code and never saw the blocks.
- The benchmark **grades the JavaScript Blockly generates from the blocks**, like the
  other formats, with the same time limits. (Blockly's code runs inside a function
  scope in the sandbox, see `scoped()` in `scripts/execute.ts`: top-level variables in a
  `node:vm` context are about 250x slower than locals, which a browser does not suffer from.
  What remains is Blockly's own overhead: about 4x slower than the program as written.)
  `program` in `results.json` is the model's own program
  and `dialectCorrect` says whether that program passed the checks as written, so a
  translation loss (correct as written, wrong as blocks) is visible. Reports saved before
  the translator existed keep the program in `code`.
- The model also returns an `unsupported` list for things it could not express. These
  appear in the report in its own words.

**Variables and recursion.** In Blockly only function parameters are local; every other
variable is global to the whole program. Programs that are correct as JavaScript can
therefore break once they become blocks. The first code-format probe showed it: all 16
programs were correct as written, but the 4 recursive merge sorts, which kept `left`,
`right` and `mid` as locals, returned `[2,2,5]` for `[5,2,9,1]` when run with global
variables. So the dialect has a rule: **a function that calls itself, directly or through
other functions, may not declare variables or loop counters with `var`**. It uses its
parameters, computes values inline, or calls helper functions that take parameters.
Non-recursive functions may use locals (the translator will give each function's
variables unique names). The check reports one message per recursive function, listing
the variables, under the construct key `recursive-local`.

**Positions.** Lists and text are both 1-based: `list[1]` and `text[1]` are the first item
and character. The first probe showed why this must be stated for text too: one model
treated text like ordinary JavaScript (`s[0]`) and 4 of its 36 programs were wrong.
Two static checks now catch the common 0-based slips and send the model a retry instead
of a silently wrong program: a literal position of 0 or below (`x[0]`, `x[-1]`; key
`index-zero`), and a counting loop whose first index falls below 1, such as
`for (var i = 0; ...)` reading `x[i]`, or counting from 1 but reading `x[i - 1]` (key
`index-before-1`). A replay of all 58 earlier programs rejected none that were correct
apart from the recursion rule. They cannot catch a `while` loop with a hand-managed
counter, and a loop whose body guards the first pass (`if (i > 1) { x[i - 1] }`) would be
flagged wrongly; both are rare.

The rule is deliberately conservative: it also rejects an in-place quicksort that keeps
`i` across its two recursive calls, which turned out to be safe by luck (0 wrong out of
300 random arrays with global variables). Telling lucky from broken would need a
correctness analysis, and a wrongly accepted program becomes wrong blocks that look
fine. A wrongly rejected one costs a retry. Whether models can find the rewrites is what
the next probe measures.

The report gets an "Outside the dialect (code format)" section: every construct models
wrote that the dialect rejects, how often, in how many attempts, with which models, and
what to write instead. That ranking is the to-do list for growing the dialect and the
translator, starting with the idioms that actually showed up. The failure
category is "Unsupported syntax".

A cheap probe (about $0.05 to $0.16 for two models; the dry run's estimate is the upper
end, because it assumes long replies):

```sh
npm run benchmark -- --models openai/gpt-5-mini,deepseek/deepseek-v4.1-flash --tasks bubble,faster,parity,zerosum --trials 2 --reply-format code --cap 0.25
```

Limits worth knowing: the model can slip into 0-based indexing, which the correctness
checks then report as a wrong answer, and `isDivisible(a, b)` is read as "is a
divisible by b".

## Response format and routing

By default the benchmark does what the app does: Anthropic models get no response
format constraint, and every other model is sent the JSON schema in
`src/llm/schema.ts`. That schema is recursive, because blocks contain blocks.
Some providers reject recursive schemas (Anthropic does), and some silently
ignore `response_format`. If a model fails with "HTTP / API error" on every run,
or you want a cleaner measure of the model itself, run with `--format none`. The flat reply
format uses its own, simpler schema (`FLAT_RESPONSE_SCHEMA` in `src/llm/schema.ts`)
with no recursion and no open-ended objects, so it is much less likely to be rejected.

OpenRouter may route a model to different providers between requests, and
providers differ in quantization and feature support. The provider that served
each attempt is recorded in the report. `--strict-routing` sends
`provider: {require_parameters: true, allow_fallbacks: false}`, so a request only
goes to a provider that supports every field we send, and is never retried
elsewhere. Models without such a provider fail with a "no endpoints" error
instead of being silently downgraded.

## Adding a task

Edit `TASKS` in `tasks.ts`: an `id`, a `label`, the `prompt` exactly as it would
be typed into the app, `forbidBlocks` for blocks that would be cheating, and
optionally `perf` for the large-array timing check. The checks in `evaluate()`
are written for sorting functions; a different kind of task (for example `isPrime`)
needs its own checker added there.

To change the models, edit `DEFAULT_MODELS` in `benchmark.ts` or pass `--models`.
Model slugs are checked against OpenRouter's public model list before anything runs.

## Troubleshooting

- **"Set OPENROUTER_API_KEY in the environment first."** Export the key in the
  same shell, then run again. `--dry-run` doesn't need it.
- **"Not on OpenRouter: ..."** A model slug is wrong or has been retired. Fix or
  remove it; nothing has been spent.
- **Every run for one model is "HTTP / API error".** Read the error in the
  report's run details. A 400 mentioning `response_format` or the schema means
  that provider rejects structured output; try `--format none`.
- **"Out of tokens" failures.** The model spent its whole 16,000-token output
  budget (usually reasoning) before answering. That counts as a failure for that
  model; the limits are in `src/config.ts`.
- **A run seems stuck.** Each request gives up after 120 seconds with no data.
  The console shows one line per finished run.

## How it runs TypeScript without extra tooling

Node 24 strips types natively, but the app is written for webpack. Two things
differ under plain Node, and `hooks.mjs` (loaded by `register.mjs` through
`--import`, see the `benchmark` script in `package.json`) handles both:

- imports without a file extension (`'./append'`) are resolved to the `.ts` file
- `import * as Blockly from 'blockly/core'` is mapped to `'blockly'`, because
  under Node the `blockly/core` entry point has no named exports

Nothing in `src/` needs to know about this. One rule follows from native type
stripping: imports of types must use `import type`, or Node fails with
"does not provide an export named".

To type-check the scripts (the app's own `tsc` run doesn't cover them):

```sh
npx tsc -p tsconfig.scripts.json
```

## Tests

```sh
npm test          # about 210 tests in a few seconds; no network, no API key, no cost
npm run test:full # also runs the slow scoping replay of saved reports (about 30 s)
```

They use Node's built-in test runner (`node:test`), so there is no extra dependency, and they
live in `scripts/tests/`. `npm test` runs every `scripts/tests/*.test.ts`.

| file | what it covers |
| --- | --- |
| `codeCheck.test.ts` | the code dialect checker: programs that must pass and run, 24 that must be rejected under the right construct key, noise suppression, the 1-based rewrite |
| `rules.test.ts` | the recursion rule (no locals in a function that calls itself) and the position rules (`x[0]`, loops that start below 1) |
| `scoping.test.ts` | Blockly's variable scoping: locals kept across recursive calls break, cross-function name clashes break unless each function's variables are renamed |
| `tasks.test.ts` | all 13 benchmark tasks: a correct and a plausible wrong program for each, the speed check, forbidden blocks |
| `flat.test.ts` | the flat format: round trip of every example, derived mutations, 20 wiring-error messages and hints |
| `required.test.ts` | required inputs (and the optional ones that must not be flagged) |
| `validate.test.ts` | shared validation: names, variables, slot kinds, type checks, dropdowns |
| `endToEnd.test.ts` | `generate()` against a fake OpenRouter: all three formats, retries, give-up, out-of-tokens, HTTP errors |
| `benchmark.test.ts` | the real benchmark CLI run as a child process against the same fake: statuses, categories, costs, `--report-only`, `--dry-run`, the spending cap |
| `replay.test.ts` | programs real models wrote, from `reports/` (skipped when absent); the scoping replay needs `FULL=1` |

Helpers are in `scripts/tests/helpers/`: `setup.ts` (import it first in every test file),
`sandbox.ts` (run a dialect program or generated JavaScript), `scoping.ts` (the Blockly-scoping
transform, with and without per-function renaming), `blockly.ts`, `fixtures.ts` (sample
programs, including the merge sorts that caused the scoping findings), `fakeOpenRouter.ts`
(replaces `fetch`; chat completions are answered from a callback as an event stream) and
`benchmarkStub.ts` (preloaded into the CLI by the benchmark tests).

To add a test for a new construct or rule, add a case to the table in the matching file. In
`.ts` files, imports of types must use `import type`.

## Files

| File | Purpose |
| --- | --- |
| `benchmark.ts` | command line, dry run, scheduler, spending cap, saving results |
| `tasks.ts` | the tasks and their checks |
| `execute.ts` | sandboxed execution of generated code, sorting and timing checks |
| `classify.ts` | groups error messages into failure categories |
| `summary.ts` | per-model statistics |
| `pricing.ts` | reads OpenRouter's model list and prices |
| `report.ts` | builds the HTML report |
| `types.ts` | shared types for results |
| `hooks.mjs`, `register.mjs` | the Node module resolver hook |
