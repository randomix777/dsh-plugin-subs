/**
 * The `/subscriptions-auth` host RPC channel the web Settings page drives. The
 * channel is registered only when a host `connection` service exists (the web
 * profile); headless compositions load the plugin without it. All business
 * outcomes are returned as RpcResult values; handlers never throw.
 */
import { AttachmentId } from '@deepseek-ai/dsh-attachment';
import { PROVIDER_IDS } from './store.js';
/** The RPC channel this plugin registers on the host connection. */
export const SUBSCRIPTIONS_AUTH_CHANNEL = '/subscriptions-auth';
/** Media types the attachment store accepts (ImageMediaType). */
const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Bare MP4 file names the `video` endpoint accepts (no path separators). */
const VIDEO_NAME_PATTERN = /^[\w.-]+\.mp4$/;
/** Payload carried no usable provider id — an RPC client bug, not a server failure. */
class BadRequest extends Error {
}
function ok(value) {
    return { ok: true, value };
}
function failure(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BadRequest) {
        // The issues array is zod-shaped upstream; this channel validates by hand.
        return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } };
    }
    return { ok: false, error: { code: 'internal', message, details: {} } };
}
function readProvider(payload) {
    if (typeof payload !== 'object' || payload === null)
        throw new BadRequest('payload must be an object');
    const provider = payload.provider;
    if (typeof provider !== 'string' || !PROVIDER_IDS.includes(provider)) {
        throw new BadRequest(`payload.provider must be one of ${PROVIDER_IDS.join(', ')}`);
    }
    return provider;
}
function readString(payload, field) {
    const value = payload[field];
    if (typeof value !== 'string' || value.length === 0) {
        throw new BadRequest(`payload.${field} must be a non-empty string`);
    }
    return value;
}
/** Validate the `setSpeed` endpoint's tier. */
function readSpeedTier(payload) {
    const tier = payload.tier;
    if (tier !== 'standard' && tier !== 'fast') {
        throw new BadRequest('payload.tier must be "standard" or "fast"');
    }
    return tier;
}
/** Validate the `image` endpoint's payload into a full attachment reference. */
function readImageRef(payload) {
    if (typeof payload !== 'object' || payload === null)
        throw new BadRequest('payload must be an object');
    const record = payload;
    const attachmentId = record.attachmentId;
    if (typeof attachmentId !== 'string' || attachmentId.length === 0) {
        throw new BadRequest('payload.attachmentId must be a non-empty string');
    }
    const mediaType = record.mediaType;
    if (typeof mediaType !== 'string' || !IMAGE_MEDIA_TYPES.includes(mediaType)) {
        throw new BadRequest(`payload.mediaType must be one of ${IMAGE_MEDIA_TYPES.join(', ')}`);
    }
    for (const field of ['bytes', 'width', 'height']) {
        const value = record[field];
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
            throw new BadRequest(`payload.${field} must be a positive integer`);
        }
    }
    const name = record.name;
    if (name !== undefined && typeof name !== 'string') {
        throw new BadRequest('payload.name must be a string when present');
    }
    return {
        attachmentId: AttachmentId(attachmentId),
        mediaType: mediaType,
        bytes: record.bytes,
        width: record.width,
        height: record.height,
        ...name === undefined ? {} : { name: name },
    };
}
/**
 * Validate the `video` endpoint's payload into a bare file name. Rejecting
 * anything with a path separator (the pattern allows none) pins every read
 * inside the plugin's videos directory.
 */
function readVideoName(payload) {
    if (typeof payload !== 'object' || payload === null)
        throw new BadRequest('payload must be an object');
    const name = payload.name;
    if (typeof name !== 'string' || !VIDEO_NAME_PATTERN.test(name)) {
        throw new BadRequest('payload.name must be a bare .mp4 file name');
    }
    return name;
}
/** Validate the session id both speed endpoints carry. */
function readSessionId(payload) {
    if (typeof payload !== 'object' || payload === null)
        throw new BadRequest('payload must be an object');
    return readString(payload, 'sessionId');
}
async function dispatch(controller, speed, endpoint, payload, signal) {
    switch (endpoint) {
        case 'status': {
            const entries = await Promise.all(PROVIDER_IDS.map(async (provider) => [provider, await controller.status(provider)]));
            return ok({ providers: Object.fromEntries(entries) });
        }
        case 'login':
            return ok(await controller.login(readProvider(payload)));
        case 'manual': {
            const provider = readProvider(payload);
            await controller.manual(provider, readString(payload, 'input'));
            return ok({ ok: true });
        }
        case 'cancel':
            await controller.cancel(readProvider(payload));
            return ok({ ok: true });
        case 'logout':
            await controller.logout(readProvider(payload));
            return ok({ ok: true });
        case 'usage':
            return ok(await controller.usage(readProvider(payload), signal));
        case 'image':
            return ok(await controller.readImage(readImageRef(payload), signal));
        case 'video':
            return ok(await controller.readVideo(readVideoName(payload), signal));
        case 'speed':
            return ok(await speed.speed(readSessionId(payload)));
        case 'setSpeed':
            await speed.setSpeed(readSessionId(payload), readSpeedTier(payload));
            return ok({ ok: true });
        default:
            throw new BadRequest(`unknown /subscriptions-auth endpoint "${endpoint}"`);
    }
}
/**
 * Register the `/subscriptions-auth` RPC channel when a host connection exists.
 * @param ctx - the plugin context (headless profiles have no `connection`).
 * @param controller - the auth operations backing the endpoints.
 * @param speed - the per-session speed-tier state backing the Speed toggle.
 */
export function registerAuthRpc(ctx, controller, speed) {
    // `connection` is not in this plugin's inject list (headless compositions
    // lack it), so its startup order is unconstrained: defer registration until
    // the service exists instead of probing once at apply time.
    ctx.inject(['connection'], (ctx) => {
        const connection = ctx.get('connection');
        ctx.effect(() => connection.rpc.handle(SUBSCRIPTIONS_AUTH_CHANNEL, async (endpoint, payload, signal) => {
            try {
                return await dispatch(controller, speed, endpoint, payload, signal);
            }
            catch (error) {
                return failure(error);
            }
        }, { authority: 'loopback' }), 'dsh-plugin-subscriptions: /subscriptions-auth rpc channel');
    });
}
