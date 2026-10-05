import {checkCode, violationMessages} from './codeCheck';

/** What an attempt in the code reply format produced. */
export interface CodeAttemptInfo {
  /** The program as the model wrote it, in the dialect (1-based lists). */
  code: string;
  /** What the model said it could not express, from its "unsupported" list. */
  unsupportedNotes: string[];
  /** How often each construct appeared (see CodeCheckResult.constructs). */
  constructs: Record<string, number>;
}

export interface CodeReplyResult {
  /** Null when the reply had no usable "code" string. */
  info: CodeAttemptInfo | null;
  summary?: string;
  /** Problems written for the model; empty means the program passed the check. */
  errors: string[];
}

/** Reads a parsed code-format reply and checks the program against the dialect. */
export function checkCodeReply(
  parsed: unknown,
  knownFunctions: Iterable<string>,
): CodeReplyResult {
  const raw =
    parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const code = raw.code;
  if (typeof code !== 'string' || !code.trim()) {
    return {
      info: null,
      errors: [
        'The reply must be a JSON object with a "code" string holding the whole program.',
      ],
    };
  }
  const notes = Array.isArray(raw.unsupported)
    ? raw.unsupported.map(String).filter(Boolean)
    : [];
  const check = checkCode(code, knownFunctions);
  return {
    info: {code, unsupportedNotes: notes, constructs: check.constructs},
    summary: typeof raw.summary === 'string' ? raw.summary : undefined,
    errors: check.ok ? [] : violationMessages(check),
  };
}
