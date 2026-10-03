export interface ModelInfo {
  id: string;
  /** USD per token. */
  promptPrice: number;
  completionPrice: number;
  contextLength: number | null;
  supportsStructuredOutput: boolean;
  supportsReasoning: boolean;
}

/** Reads OpenRouter's public model list (no API key needed). */
export async function fetchModelInfo(): Promise<Map<string, ModelInfo>> {
  const response = await fetch('https://openrouter.ai/api/v1/models');
  if (!response.ok) {
    throw new Error(`Could not read the OpenRouter model list: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {data: Array<Record<string, any>>};
  const models = new Map<string, ModelInfo>();
  for (const m of body.data) {
    const params: string[] = m.supported_parameters ?? [];
    models.set(m.id, {
      id: m.id,
      promptPrice: Number(m.pricing?.prompt ?? 0),
      completionPrice: Number(m.pricing?.completion ?? 0),
      contextLength: m.context_length ?? null,
      supportsStructuredOutput:
        params.includes('structured_outputs') || params.includes('response_format'),
      supportsReasoning: params.includes('reasoning'),
    });
  }
  return models;
}

export function estimateCost(
  info: ModelInfo,
  promptTokens: number,
  completionTokens: number,
): number {
  return promptTokens * info.promptPrice + completionTokens * info.completionPrice;
}
