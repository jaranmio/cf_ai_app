import { describe, it, expect } from 'vitest';
import handler from '../src/index';

// Minimal AI stub to satisfy env.AI.run for validation tests without invoking real model.
class AIStub {
  async run(model: string, payload: any, opts: any): Promise<Response> {
    // Return a dummy streaming-like Response with one JSON line
    const body = new ReadableStream({
      start(controller) {
        const chunk = JSON.stringify({ response: 'hello' }) + '\n';
        controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      }
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  }
}

describe('chat handler validation', () => {
  it('rejects too many messages', async () => {
    const tooMany = Array.from({ length: 41 }, (_, i) => ({ role: 'user', content: 'x' + i }));
    const req = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: tooMany })
    });
    // @ts-ignore Env provided dynamically
    const env: Env = { AI: new AIStub(), ASSETS: { fetch: (r: Request) => Promise.resolve(new Response('')) }, TASK_SCHEDULER: { idFromName(){ throw new Error('not used'); }, get(){ throw new Error('not used'); } } } as any;
    const res = await handler.fetch!(req, env, {} as ExecutionContext);
    expect(res.status).toBe(413);
  });

  it('accepts reasonable message payload and streams', async () => {
    const msgs = [{ role: 'user', content: 'Hello' }];
    const req = new Request('https://example.com/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs })
    });
    // @ts-ignore
    const env: Env = { AI: new AIStub(), ASSETS: { fetch: (r: Request) => Promise.resolve(new Response('')) }, TASK_SCHEDULER: { idFromName(){ throw new Error('not used'); }, get(){ throw new Error('not used'); } } } as any;
    const res = await handler.fetch!(req, env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/hello/);
  });
});
