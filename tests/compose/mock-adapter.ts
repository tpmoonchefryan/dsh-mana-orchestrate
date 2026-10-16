/**
 * Minimal scripted LlmAdapter for the composition test: every model call records its request and
 * answers with one short text response. Written in this repo because the monorepo's
 * core/agent-loop/tests/mock-adapter.ts is not published to npm.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export class MockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  private readonly reply: string

  constructor(reply = 'ok') {
    super()
    this.reply = reply
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const text = this.reply
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
