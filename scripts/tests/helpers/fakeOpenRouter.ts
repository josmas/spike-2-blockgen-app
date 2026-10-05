/**
 * A stand-in for OpenRouter, for offline tests. It replaces globalThis.fetch:
 * chat completions are answered from a callback (as a server-sent-events
 * stream, like the real thing), the public model list is canned, and every
 * other request goes through to the real fetch.
 */

export type ReplyFormatSeen = 'nested' | 'flat' | 'code';

export interface FakeRequest {
  model: string;
  /** True when the conversation already holds a failed attempt. */
  retry: boolean;
  /** Which prompt the app sent. */
  format: ReplyFormatSeen;
  body: Record<string, any>;
}

export type FakeReply =
  | {text: string; finishReason?: string; cost?: number}
  | {status: number; body: string};

export interface FakeOpenRouter {
  requests: FakeRequest[];
  restore(): void;
}

const encoder = new TextEncoder();

function formatOf(body: Record<string, any>): ReplyFormatSeen {
  const system: string = body.messages?.[0]?.content ?? '';
  if (system.includes('program writer for a block-based language')) return 'code';
  if (system.includes('ONE BLOCK PER LINE')) return 'flat';
  return 'nested';
}

function stream(text: string, finishReason: string, cost: number): Response {
  const event = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'));
        if (text) controller.enqueue(event({provider: 'FakeProvider', choices: [{delta: {content: text}}]}));
        controller.enqueue(event({provider: 'FakeProvider', choices: [{delta: {}, finish_reason: finishReason}]}));
        controller.enqueue(event({
          provider: 'FakeProvider',
          choices: [],
          usage: {prompt_tokens: 2000, completion_tokens: 500, cost, completion_tokens_details: {reasoning_tokens: 0}},
        }));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    {status: 200, headers: {'content-type': 'text/event-stream'}},
  );
}

/** @param models slugs to list in the canned model list (so a dry run needs no network) */
export function installFakeOpenRouter(
  reply: (request: FakeRequest) => FakeReply,
  models: string[] = [],
): FakeOpenRouter {
  const realFetch = globalThis.fetch;
  const requests: FakeRequest[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/v1/models')) {
      return Response.json({
        data: models.map((id) => ({
          id,
          pricing: {prompt: '0.0000003', completion: '0.000001'},
          context_length: 100000,
          supported_parameters: ['reasoning', 'response_format', 'structured_outputs'],
        })),
      });
    }
    if (!url.includes('chat/completions')) return realFetch(input, init);

    const body = JSON.parse(String(init?.body));
    const request: FakeRequest = {
      model: body.model,
      retry: (body.messages?.length ?? 0) > 2,
      format: formatOf(body),
      body,
    };
    requests.push(request);
    const answer = reply(request);
    if ('status' in answer) return new Response(answer.body, {status: answer.status});
    return stream(answer.text, answer.finishReason ?? 'stop', answer.cost ?? 0.001);
  }) as typeof fetch;

  return {requests, restore: () => { globalThis.fetch = realFetch; }};
}
