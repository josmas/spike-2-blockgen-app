import type {FailureCategory, RunResult} from './types';

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export interface ModelSummary {
  model: string;
  /** Runs that finished (aborted runs are excluded everywhere). */
  runs: number;
  correct: number;
  wrong: number;
  failed: number;
  /** Runs whose very first attempt was accepted. */
  firstAttemptAccepted: number;
  meanAttempts: number | null;
  medianSeconds: number | null;
  maxSeconds: number | null;
  medianFirstDataSeconds: number | null;
  meanCost: number | null;
  totalCost: number;
  meanCompletionTokens: number | null;
  meanReasoningTokens: number | null;
  /** Rejected or errored attempts, by category (counts attempts, not runs). */
  categories: Partial<Record<FailureCategory, number>>;
  /** Correct / finished runs per task id. */
  byTask: Record<string, {correct: number; runs: number}>;
  providers: string[];
}

export function summarize(results: RunResult[]): ModelSummary[] {
  const byModel = new Map<string, RunResult[]>();
  for (const r of results) {
    if (r.status === 'aborted') continue;
    byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  }

  const summaries: ModelSummary[] = [];
  for (const [model, runs] of byModel) {
    const categories: Partial<Record<FailureCategory, number>> = {};
    const byTask: ModelSummary['byTask'] = {};
    const providers = new Set<string>();
    for (const r of runs) {
      for (const p of r.providers) providers.add(p);
      byTask[r.taskId] ??= {correct: 0, runs: 0};
      byTask[r.taskId].runs++;
      if (r.status === 'correct') byTask[r.taskId].correct++;
      for (const a of r.attempts) {
        for (const c of a.categories) categories[c] = (categories[c] ?? 0) + 1;
      }
    }
    const seconds = runs.map((r) => r.durationMs / 1000);
    const firstData = runs.flatMap((r) =>
      r.attempts[0]?.stats?.firstDataMs != null
        ? [r.attempts[0].stats.firstDataMs / 1000]
        : [],
    );
    summaries.push({
      model,
      runs: runs.length,
      correct: runs.filter((r) => r.status === 'correct').length,
      wrong: runs.filter((r) => r.status === 'wrong').length,
      failed: runs.filter((r) => r.status === 'failed').length,
      firstAttemptAccepted: runs.filter((r) => r.acceptedOnAttempt === 1).length,
      meanAttempts: mean(runs.map((r) => r.attempts.length)),
      medianSeconds: median(seconds),
      maxSeconds: seconds.length ? Math.max(...seconds) : null,
      medianFirstDataSeconds: median(firstData),
      meanCost: mean(runs.map((r) => r.cost)),
      totalCost: runs.reduce((sum, r) => sum + r.cost, 0),
      meanCompletionTokens: mean(runs.map((r) => r.completionTokens)),
      meanReasoningTokens: mean(runs.map((r) => r.reasoningTokens)),
      categories,
      byTask,
      providers: [...providers],
    });
  }

  // Best first: most correct, then fewest wrong answers, then cheapest.
  return summaries.sort(
    (a, b) =>
      b.correct / b.runs - a.correct / a.runs ||
      a.failed / a.runs - b.failed / b.runs ||
      (a.meanCost ?? 0) - (b.meanCost ?? 0),
  );
}

export const usd = (value: number | null, digits = 4): string =>
  value === null ? 'n/a' : `$${value.toFixed(digits)}`;

export const pct = (part: number, whole: number): string =>
  whole ? `${Math.round((part / whole) * 100)}%` : 'n/a';
