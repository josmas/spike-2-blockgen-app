/**
 * Turns the model's reply into an object. Ported from qualia's
 * server/lib/qualia-writer.ts (parseJsonResponse / fixJsonStrings).
 */

export interface ModelResponse {
  summary?: string;
  workspaceJson: {
    blocks: {languageVersion?: number; blocks: Record<string, unknown>[]};
    variables?: {name: string; id: string; type?: string}[];
  };
}

/**
 * Parses a model reply as JSON, tolerating markdown fences, prose before the
 * object, and a few common string mistakes. Used by both reply formats.
 */
export function parseJsonLoose(text: string): unknown {
  let cleaned = text.trim();
  // Greedy: first opening fence to the LAST closing fence.
  const fenceMatch = cleaned.match(/```(?:json)?\s*\n([\s\S]*)\n\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // Skip any prose before the JSON object.
  const start = cleaned.indexOf('{');
  if (start > 0) cleaned = cleaned.slice(start);
  const fixed = fixJsonStrings(cleaned);
  try {
    return JSON.parse(fixed);
  } catch (e) {
    throw new Error(describeJsonError(e, fixed));
  }
}

/** Parses a reply in the nested format. */
export function parseResponse(text: string): ModelResponse {
  return parseJsonLoose(text) as ModelResponse;
}

/**
 * Turns "...at position 3493" into a message the model can act on, by
 * quoting the text around the error. The position alone means nothing to it.
 */
function describeJsonError(e: unknown, text: string): string {
  const message = e instanceof Error ? e.message : String(e);
  const match = message.match(/position (\d+)/);
  if (!match) return message;
  const pos = Number(match[1]);
  const before = text.slice(Math.max(0, pos - 120), pos);
  const after = text.slice(pos, pos + 40);
  return `${message}. The text around the error is: ${before}<<ERROR HERE>>${after}`;
}

// Character scan that fixes common model mistakes inside strings:
//   1. Backtick-delimited strings -> double-quoted JSON strings
//   2. Raw newlines/carriage returns -> \n / \r
//   3. Invalid \' escape -> '
function fixJsonStrings(text: string): string {
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      out.push('"');
      i++;
      while (i < text.length) {
        const sc = text[i];
        if (sc === '\\') {
          const next = text[i + 1] ?? '';
          if (next === "'") {
            out.push("'");
          } else {
            out.push(sc, next);
          }
          i += 2;
        } else if (sc === '"') {
          out.push('"');
          i++;
          break;
        } else if (sc === '\n') {
          out.push('\\n');
          i++;
        } else if (sc === '\r') {
          out.push('\\r');
          i++;
        } else {
          out.push(sc);
          i++;
        }
      }
    } else if (ch === '`') {
      out.push('"');
      i++;
      while (i < text.length) {
        const sc = text[i];
        if (sc === '`') {
          out.push('"');
          i++;
          break;
        } else if (sc === '"') {
          out.push('\\"');
          i++;
        } else if (sc === '\n') {
          out.push('\\n');
          i++;
        } else if (sc === '\r') {
          out.push('\\r');
          i++;
        } else {
          out.push(sc);
          i++;
        }
      }
    } else {
      out.push(ch);
      i++;
    }
  }

  return out.join('');
}
