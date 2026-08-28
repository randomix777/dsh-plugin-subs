/**
 * Translate between the harness message vocabulary and the Anthropic Messages
 * API wire format used by the claude provider: request message assembly, tool
 * schema mapping, and a push-model SSE-event → StreamChunk state machine
 * ({@link AnthropicStreamTranslator}) so tests need no streams.
 */
import { CallId, CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, LlmError, } from '@deepseek-ai/dsh-llm';
import { parseSse } from './sse.js';
/**
 * The Claude Code identity block. The subscription endpoint rejects requests
 * that do not present as Claude Code, so this block is REQUIRED as the first
 * system entry on every request.
 */
export const CLAUDE_CODE_IDENTITY = 'You are Claude Code, Anthropic\'s official CLI for Claude.';
/** Flatten a tool result's content to plain text for `tool_result`. */
function toolResultText(block) {
    return block.content.map(part => (part.type === 'text' ? part.text : '')).join('');
}
/** Parse a tool call's raw JSON arguments into Anthropic's object-shaped `input`. */
function parseToolInput(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    }
    catch {
        // The model produced malformed JSON; an empty object keeps the request valid.
        return {};
    }
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
export function toAnthropicMessages(messages) {
    const out = [];
    for (const message of messages) {
        if (message.role === 'system')
            continue;
        const role = message.role;
        const blocks = [];
        for (const block of message.content) {
            switch (block.type) {
                case 'text':
                    blocks.push({ type: 'text', text: block.text });
                    break;
                case 'tool-call':
                    blocks.push({
                        type: 'tool_use',
                        id: String(block.id),
                        name: block.name,
                        input: parseToolInput(block.arguments),
                    });
                    break;
                case 'tool-result':
                    blocks.push({
                        type: 'tool_result',
                        tool_use_id: String(block.toolCallId),
                        content: toolResultText(block),
                        ...block.isError === true ? { is_error: true } : {},
                    });
                    break;
                case 'image':
                    if ('dataBase64' in block) {
                        blocks.push({
                            type: 'image',
                            source: { type: 'base64', media_type: block.mediaType, data: block.dataBase64 },
                        });
                    }
                    // An unresolved ImageBlock carries only an attachment reference; the
                    // adapter resolves images before translation, so this is skipped.
                    break;
                default:
                    // reasoning (not replayed), unknown blocks.
                    break;
            }
        }
        if (blocks.length === 0)
            continue;
        const last = out[out.length - 1];
        if (last !== undefined && last.role === role)
            last.content.push(...blocks);
        else
            out.push({ role, content: blocks });
    }
    return out;
}
/**
 * Build the Anthropic `system` array: the mandatory Claude Code identity
 * block, then the explicit system prompt, then any system-role messages.
 * @param system - explicit system prompt, when set.
 * @param messages - conversation messages; their system-role text is appended.
 * @returns the system content blocks.
 */
export function toAnthropicSystem(system, messages) {
    const blocks = [{ type: 'text', text: CLAUDE_CODE_IDENTITY }];
    if (system !== undefined && system.length > 0)
        blocks.push({ type: 'text', text: system });
    for (const message of messages ?? []) {
        if (message.role !== 'system')
            continue;
        for (const block of message.content) {
            if (block.type === 'text')
                blocks.push({ type: 'text', text: block.text });
        }
    }
    return blocks;
}
/**
 * Map harness tool schemas to Anthropic tools.
 * @param tools - tool schemas from the request.
 * @returns Anthropic `tools` array entries.
 */
export function toAnthropicTools(tools) {
    return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
    }));
}
/** Assemble the final ContentBlock for one open block. */
function closeBlock(block) {
    switch (block.kind) {
        case 'text':
            return { type: 'text', text: block.text };
        case 'reasoning':
            return { type: 'reasoning', text: block.text };
        case 'tool-call':
            return {
                type: 'tool-call',
                id: CallId(block.callId),
                name: block.name ?? '',
                arguments: block.text,
            };
    }
}
/**
 * Classify an Anthropic `error` event into a thrown LlmError.
 * @param error - the wire error object.
 * @returns the mapped error.
 */
export function anthropicFailure(error) {
    const type = error?.type ?? 'unknown_error';
    const message = error?.message ?? `Anthropic reported ${type}`;
    if (type === 'invalid_request_error' && /prompt is too long/i.test(message)) {
        return new LlmError(message, CONTEXT_WINDOW_EXCEEDED_CODE);
    }
    if (type === 'rate_limit_error')
        return new LlmError(message, 'RATE_LIMIT');
    if (type === 'authentication_error')
        return new LlmError(message, 'AUTH');
    return new LlmError(message, 'SERVER');
}
/**
 * Push-model Anthropic SSE translator: feed each parsed event object to
 * {@link push} and collect the emitted harness StreamChunks. Block indexes
 * are allocated in first-seen order; `usage` is emitted before the terminal
 * `finish`, and nothing is emitted after it. `error` events throw
 * {@link LlmError}.
 */
export class AnthropicStreamTranslator {
    blocks = new Map();
    nextIndex = 0;
    sawAnyBlock = false;
    pendingUsage;
    outputTokens;
    stopReason = 'stop';
    usageEmitted = false;
    /** Set once `message_stop` produced the terminal finish chunk. */
    terminated = false;
    open(wireIndex, kind, chunks, callId = '', name) {
        const block = {
            index: this.nextIndex++,
            kind,
            text: '',
            callId,
            ...name === undefined ? {} : { name },
        };
        this.blocks.set(wireIndex, block);
        this.sawAnyBlock = true;
        chunks.push({ type: 'block-start', index: block.index, blockType: kind });
        return block;
    }
    emitUsage(chunks) {
        if (this.usageEmitted)
            return;
        this.usageEmitted = true;
        const usage = {
            inputTokens: this.pendingUsage?.inputTokens ?? 0,
            outputTokens: this.outputTokens ?? 0,
            ...this.pendingUsage?.cacheReadTokens !== undefined
                ? { cacheReadTokens: this.pendingUsage.cacheReadTokens }
                : {},
            ...this.pendingUsage?.cacheWriteTokens !== undefined
                ? { cacheWriteTokens: this.pendingUsage.cacheWriteTokens }
                : {},
        };
        chunks.push({ type: 'usage', usage });
    }
    /**
     * Process one parsed Anthropic SSE event.
     * @param event - the parsed event object.
     * @returns the StreamChunks this event produced (possibly none).
     */
    push(event) {
        if (this.terminated)
            return [];
        const chunks = [];
        switch (event.type) {
            case 'message_start': {
                const usage = event.message?.usage;
                if (usage !== undefined) {
                    this.pendingUsage = {
                        inputTokens: usage.input_tokens ?? 0,
                        ...usage.cache_read_input_tokens !== undefined
                            ? { cacheReadTokens: usage.cache_read_input_tokens }
                            : {},
                        ...usage.cache_creation_input_tokens !== undefined
                            ? { cacheWriteTokens: usage.cache_creation_input_tokens }
                            : {},
                    };
                    this.outputTokens = usage.output_tokens ?? this.outputTokens;
                }
                return chunks;
            }
            case 'content_block_start': {
                const wireIndex = event.index ?? 0;
                const block = event.content_block;
                switch (block?.type) {
                    case 'text':
                        this.open(wireIndex, 'text', chunks);
                        break;
                    case 'thinking':
                        this.open(wireIndex, 'reasoning', chunks);
                        break;
                    case 'tool_use': {
                        const opened = this.open(wireIndex, 'tool-call', chunks, block.id ?? '', block.name);
                        chunks.push({
                            type: 'tool-call-delta',
                            index: opened.index,
                            id: CallId(opened.callId),
                            ...block.name === undefined ? {} : { name: block.name },
                            argumentsDelta: '',
                        });
                        break;
                    }
                    default:
                        break;
                }
                return chunks;
            }
            case 'content_block_delta': {
                const wireIndex = event.index ?? 0;
                const block = this.blocks.get(wireIndex);
                const delta = event.delta;
                if (block === undefined || delta === undefined)
                    return chunks;
                switch (delta.type) {
                    case 'text_delta':
                        block.text += delta.text ?? '';
                        chunks.push({ type: 'text-delta', index: block.index, text: delta.text ?? '' });
                        break;
                    case 'thinking_delta':
                        block.text += delta.thinking ?? '';
                        chunks.push({ type: 'reasoning-delta', index: block.index, text: delta.thinking ?? '' });
                        break;
                    case 'input_json_delta':
                        block.text += delta.partial_json ?? '';
                        chunks.push({
                            type: 'tool-call-delta',
                            index: block.index,
                            id: CallId(block.callId),
                            ...block.name === undefined ? {} : { name: block.name },
                            argumentsDelta: delta.partial_json ?? '',
                        });
                        break;
                    default:
                        // signature_delta and future deltas carry no harness content.
                        break;
                }
                return chunks;
            }
            case 'content_block_stop': {
                const wireIndex = event.index ?? 0;
                const block = this.blocks.get(wireIndex);
                if (block === undefined)
                    return chunks;
                this.blocks.delete(wireIndex);
                chunks.push({ type: 'block-end', index: block.index, block: closeBlock(block) });
                return chunks;
            }
            case 'message_delta': {
                if (event.usage?.output_tokens !== undefined)
                    this.outputTokens = event.usage.output_tokens;
                switch (event.delta?.stop_reason) {
                    case 'end_turn':
                    case 'stop_sequence':
                        this.stopReason = 'stop';
                        break;
                    case 'tool_use':
                        this.stopReason = 'tool-calls';
                        break;
                    case 'max_tokens':
                        this.stopReason = 'max-tokens';
                        break;
                    default:
                        break;
                }
                return chunks;
            }
            case 'message_stop': {
                this.terminated = true;
                for (const [wireIndex, block] of [...this.blocks]) {
                    this.blocks.delete(wireIndex);
                    chunks.push({ type: 'block-end', index: block.index, block: closeBlock(block) });
                }
                this.emitUsage(chunks);
                if (this.stopReason === 'stop' && !this.sawAnyBlock) {
                    chunks.push({
                        type: 'finish',
                        reason: {
                            kind: 'error',
                            failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
                        },
                    });
                }
                else {
                    chunks.push({ type: 'finish', reason: { kind: this.stopReason } });
                }
                return chunks;
            }
            case 'error':
                throw anthropicFailure(event.error);
            default:
                // ping and future event types carry no harness content.
                return chunks;
        }
    }
}
/**
 * Consume an Anthropic SSE byte stream and yield harness StreamChunks.
 * @param stream - raw response body.
 * @param onActivity - transport-activity callback for the idle watchdog.
 * @returns the chunk stream; throws when the stream ends before `message_stop`.
 */
export async function* streamAnthropic(stream, onActivity) {
    const translator = new AnthropicStreamTranslator();
    for await (const sseEvent of parseSse(stream, onActivity)) {
        let event;
        try {
            event = JSON.parse(sseEvent.data);
        }
        catch {
            throw new LlmError(`malformed SSE payload: ${sseEvent.data.slice(0, 120)}`, 'MALFORMED_RESPONSE');
        }
        yield* translator.push(event);
        if (translator.terminated)
            return;
    }
    throw new LlmError('Anthropic SSE stream ended before message_stop', 'STREAM_CLOSED');
}
