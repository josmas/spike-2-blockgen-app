import type {ChatStats} from '../src/llm/openrouter';

/** Why an attempt (or a whole run) failed, in coarse buckets. */
export type FailureCategory =
  | 'invalid-json'
  | 'block-type'
  | 'wrong-slot'
  | 'type-mismatch'
  | 'function-names'
  | 'variables'
  | 'unsupported-syntax'
  | 'untranslatable'
  | 'flat-structure'
  | 'empty-input'
  | 'blockly-load'
  | 'javascript'
  | 'http-error'
  | 'timeout'
  | 'out-of-tokens'
  | 'no-content'
  | 'other';

export interface AttemptRecord {
  attempt: number;
  temperature: number;
  outcome: 'accepted' | 'rejected' | 'request-error';
  errors: string[];
  categories: FailureCategory[];
  /** Raw reply (truncated to keep the results file manageable). */
  reply: string | null;
  replyChars: number;
  stats: ChatStats | null;
  /** Code format only: how often each construct appeared in this attempt. */
  constructs?: Record<string, number>;
  /** Code format only: what the model said it could not express. */
  unsupportedNotes?: string[];
}

/** One check run against the accepted program. */
export interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export type RunStatus =
  /** Accepted by validation and passed every check. */
  | 'correct'
  /** Accepted by validation, but a check failed. */
  | 'wrong'
  /** Never accepted. */
  | 'failed'
  /** Stopped early, e.g. because the spending cap was reached. Not counted. */
  | 'aborted';

export interface RunResult {
  id: string;
  model: string;
  taskId: string;
  trial: number;
  responseFormat: string;
  /** Which reply format the model was asked for: nested or flat. */
  replyFormat: string;
  /** Providers that served this run's requests, in order of first use. */
  providers: string[];
  startedAt: string;
  durationMs: number;
  status: RunStatus;
  attempts: AttemptRecord[];
  /** Number of the attempt that was accepted, or null. */
  acceptedOnAttempt: number | null;
  /** Final error when the run did not produce an accepted program. */
  finalError: string | null;
  summary: string | null;
  /** JavaScript Blockly generated from the accepted workspace. */
  code: string | null;
  /**
   * Code format only: the program the model wrote, in the dialect (1-based
   * lists). Reports saved before the translator existed have it in `code`.
   */
  program?: string | null;
  /** Code format only: did the program, run as written, pass every check? */
  dialectCorrect?: boolean | null;
  functionNames: string[];
  blockCount: number | null;
  checks: CheckResult[];
  /** Output lines the program wrote with addText when executed. */
  programOutput: string[];
  cost: number;
  /** True when some of the cost was estimated from tokens, not reported. */
  costEstimated: boolean;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

export interface RunMeta {
  startedAt: string;
  finishedAt: string | null;
  models: string[];
  taskIds: string[];
  trials: number;
  responseFormatMode: string;
  replyFormatMode: string;
  strictRouting: boolean;
  capUsd: number;
  spentUsd: number;
  /** True if the spending cap or Ctrl-C ended the run before it finished. */
  stoppedEarly: boolean;
  notes: string[];
}

export interface ResultsFile {
  meta: RunMeta;
  results: RunResult[];
}
