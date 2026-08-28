/**
 * Resolved-image plumbing for the wire translators. ImageBlocks carry only an
 * attachment reference; the bytes live in the attachment service, which is
 * async I/O. Adapters resolve images BEFORE calling the (pure, synchronous)
 * translators, so the translators see {@link ResolvedImagePart}s with inline
 * base64 data.
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
/**
 * Resolve every ImageBlock's attachment reference to inline base64 bytes.
 * Messages without images pass through unchanged. A request carrying an image
 * with no attachment service available fails loudly rather than silently
 * dropping the image.
 * @param messages - the request's conversation messages.
 * @param attachments - the deployment's attachment service, when mounted.
 * @param signal - cancellation for the storage reads.
 * @returns the same messages with image blocks resolved for the translators.
 */
export async function resolveImages(messages, attachments, signal) {
    if (!messages.some(message => message.content.some(block => block.type === 'image'))) {
        return messages;
    }
    if (attachments === undefined) {
        throw new LlmError('dsh-plugin-subscriptions: the request carries an image but no attachments service is mounted; '
            + 'image input requires the harness attachment store', 'UNSUPPORTED');
    }
    return Promise.all(messages.map(async (message) => ({
        role: message.role,
        content: await Promise.all(message.content.map(async (block) => {
            if (block.type !== 'image')
                return block;
            const stored = await attachments.readImage(block.attachment, signal);
            return {
                type: 'image',
                mediaType: stored.ref.mediaType,
                dataBase64: Buffer.from(stored.data).toString('base64'),
            };
        })),
    })));
}
