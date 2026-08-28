/**
 * Translate between the harness message vocabulary and the Anthropic Messages
 * API wire format used by the claude provider: request message assembly, tool
 * schema mapping, and a push-model SSE-event → StreamChunk state machine
 * ({@link AnthropicStreamTranslator}) so tests need no streams.
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
import type { StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm';
import type { TranslatableMessage } from './resolved.js';
/**
 * The Claude Code identity block. The subscription endpoint rejects requests
 * that do not present as Claude Code, so this block is REQUIRED as the first
 * system entry on every request.
 */
export declare const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
/** One Anthropic request message. */
export interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: Record<string, unknown>[];
}
/**
 * Convert harness messages into Anthropic messages. Consecutive same-role
 * messages merge into one message with multiple content blocks; tool results
 * arrive as user messages with `tool_result` blocks; system-role messages are
 * handled by {@link toAnthropicSystem} and skipped here. Reasoning blocks are
 * not replayed (v1). Images must arrive pre-resolved
 * ({@link TranslatableMessage}); an unresolved ImageBlock is skipped because
 * its bytes are unreachable here.
 * @param messages - ordered conversation messages with resolved images.
 * @returns Anthropic messages in conversation order.
 */
export declare function toAnthropicMessages(messages: readonly TranslatableMessage[]): AnthropicMessage[];
/**
 * Build the Anthropic `system` array: the mandatory Claude Code identity
 * block, then the explicit system prompt, then any system-role messages.
 * @param system - explicit system prompt, when set.
 * @param messages - conversation messages; their system-role text is appended.
 * @returns the system content blocks.
 */
export declare function toAnthropicSystem(system?: string, messages?: readonly TranslatableMessage[]): Record<string, unknown>[];
/**
 * Map harness tool schemas to Anthropic tools.
 * @param tools - tool schemas from the request.
 * @returns Anthropic `tools` array entries.
 */
export declare function toAnthropicTools(tools: readonly ToolSchema[]): Record<string, unknown>[];
/** The subset of Anthropic SSE event shapes this translator reads. */
export interface AnthropicStreamEvent {
    type: string;
    index?: number;
    message?: {
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        };
    };
    content_block?: {
        type?: string;
        id?: string;
        name?: string;
    };
    delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
        stop_reason?: string;
    };
    usage?: {
        output_tokens?: number;
    };
    error?: {
        type?: string;
        message?: string;
    };
}
/**
 * Classify an Anthropic `error` event into a thrown LlmError.
 * @param error - the wire error object.
 * @returns the mapped error.
 */
export declare function anthropicFailure(error: {
    type?: string;
    message?: string;
} | undefined): LlmError;
/**
 * Push-model Anthropic SSE translator: feed each parsed event object to
 * {@link push} and collect the emitted harness StreamChunks. Block indexes
 * are allocated in first-seen order; `usage` is emitted before the terminal
 * `finish`, and nothing is emitted after it. `error` events throw
 * {@link LlmError}.
 */
export declare class AnthropicStreamTranslator {
    private blocks;
    private nextIndex;
    private sawAnyBlock;
    private pendingUsage;
    private outputTokens;
    private stopReason;
    private usageEmitted;
    /** Set once `message_stop` produced the terminal finish chunk. */
    terminated: boolean;
    private open;
    private emitUsage;
    /**
     * Process one parsed Anthropic SSE event.
     * @param event - the parsed event object.
     * @returns the StreamChunks this event produced (possibly none).
     */
    push(event: AnthropicStreamEvent): StreamChunk[];
}
/**
 * Consume an Anthropic SSE byte stream and yield harness StreamChunks.
 * @param stream - raw response body.
 * @param onActivity - transport-activity callback for the idle watchdog.
 * @returns the chunk stream; throws when the stream ends before `message_stop`.
 */
export declare function streamAnthropic(stream: ReadableStream<Uint8Array>, onActivity?: () => void): AsyncGenerator<StreamChunk>;
