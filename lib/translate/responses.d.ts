/**
 * Translate between the harness message vocabulary and the OpenAI Responses
 * API wire format shared by the codex and grok providers: request input
 * assembly, tool schema mapping, and a push-model SSE-event → StreamChunk
 * state machine ({@link ResponsesStreamTranslator}) so tests need no streams.
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
import type { StreamChunk, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm';
import type { TranslatableMessage } from './resolved.js';
/** Assembled `instructions` + `input` pair for one Responses request. */
export interface ResponsesRequestInput {
    /** System text for the top-level `instructions` field; absent when there is none. */
    instructions?: string;
    /** Responses `input` items in conversation order. */
    input: Record<string, unknown>[];
}
/**
 * Convert harness messages into Responses `instructions` + `input` items.
 * System-role messages become `instructions`; an explicit `system` argument
 * wins over them when both exist. Reasoning blocks are not replayed (v1).
 * Images must arrive pre-resolved ({@link TranslatableMessage}); an unresolved
 * ImageBlock is skipped because its bytes are unreachable here.
 * @param messages - ordered conversation messages with resolved images.
 * @param system - explicit system prompt, which takes precedence.
 * @returns request fields ready to merge into the request body.
 */
export declare function toResponsesInput(messages: readonly TranslatableMessage[], system?: string): ResponsesRequestInput;
/**
 * Map harness tool schemas to Responses function tools.
 * @param tools - tool schemas from the request.
 * @returns Responses `tools` array entries.
 */
export declare function toResponsesTools(tools: readonly ToolSchema[]): Record<string, unknown>[];
/** The subset of Responses SSE event shapes this translator reads. */
export interface ResponsesStreamEvent {
    type: string;
    item_id?: string;
    content_index?: number;
    summary_index?: number;
    delta?: string;
    item?: {
        type?: string;
        id?: string;
        call_id?: string;
        name?: string;
        arguments?: string;
        content?: Array<{
            type?: string;
            text?: string;
        }>;
    };
    response?: {
        status?: string;
        usage?: ResponsesUsage;
        error?: {
            code?: string;
            message?: string;
        };
        incomplete_details?: {
            reason?: string;
        };
    };
    code?: string;
    message?: string;
}
/** Responses `usage` object shape. */
export interface ResponsesUsage {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: {
        cached_tokens?: number;
    };
    output_tokens_details?: {
        reasoning_tokens?: number;
    };
}
/**
 * Map Responses usage to disjoint harness counts (cached input is subtracted
 * out of `inputTokens` and reported as `cacheReadTokens`).
 * @param usage - wire usage from `response.completed`.
 * @returns harness token usage.
 */
export declare function mapResponsesUsage(usage: ResponsesUsage): TokenUsage;
/**
 * Classify a Responses failure payload into a thrown LlmError.
 * @param code - provider error code, when present.
 * @param message - provider error message, when present.
 * @returns the mapped error (context overflow, quota, otherwise SERVER).
 */
export declare function responsesFailure(code: string | undefined, message: string | undefined): LlmError;
/**
 * Push-model Responses SSE translator: feed each parsed event object to
 * {@link push} and collect the emitted harness StreamChunks. Block indexes
 * are allocated in first-seen order; `usage` is emitted before the terminal
 * `finish`, and nothing is emitted after it. Terminal provider failures
 * throw {@link LlmError}.
 */
export declare class ResponsesStreamTranslator {
    private blocks;
    private order;
    private nextIndex;
    private sawToolCall;
    /** Set once `response.completed` produced the terminal finish chunk. */
    terminated: boolean;
    private open;
    private textBlock;
    private reasoningBlock;
    private close;
    /** Close every still-open block for one output item (prefix match on the key). */
    private closeItem;
    /** Close every still-open block (provider ended the response without done events). */
    private closeAll;
    private closeKeyIfOpen;
    /**
     * Process one parsed Responses SSE event.
     * @param event - the parsed event object.
     * @returns the StreamChunks this event produced (possibly none).
     */
    push(event: ResponsesStreamEvent): StreamChunk[];
}
/**
 * Consume a Responses SSE byte stream and yield harness StreamChunks.
 * @param stream - raw response body.
 * @param onActivity - transport-activity callback for the idle watchdog.
 * @returns the chunk stream; throws when the stream ends before `response.completed`.
 */
export declare function streamResponses(stream: ReadableStream<Uint8Array>, onActivity?: () => void): AsyncGenerator<StreamChunk>;
