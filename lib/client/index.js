// `.js` extension: this package's tsconfig lacks the reference repo's
// allowImportingTsExtensions/rewriteRelativeImportExtensions pair; under
// nodenext the .js specifier resolves to the .tsx source (see README note).
import { SubscriptionsSection } from './SubscriptionsSection.js';
import { ImageGenerateToolview, createImageLoader } from './ImageGenerateToolview.js';
import { VideoGenerateToolview, createVideoLoader } from './VideoGenerateToolview.js';
import { SpeedSelect, createSpeedLoader, createSpeedSetter } from './SpeedSelect.js';
import { en, zh } from './locales.js';
/** Dictionary namespace owned by this plugin. */
const NS = 'settings.subscriptions';
/**
 * Required services (cordis fiber inject): `slots` carries the registration
 * seat, `connection` the `/subscriptions-auth` RPC caller, and `locale` the copy
 * dictionaries.
 */
export const inject = ['slots', 'connection', 'locale'];
/**
 * Register the Subscriptions section once the `settings.section` declaration
 * is on the ledger (the shell's apply order relative to this one is NOT
 * constrained; registration depends on the slot through `slots.inject()`).
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-plugin-subscriptions: copy dictionaries');
    // The client-runtime Context merge types `connection` as the host handle;
    // in the browser shell the same key holds the full client ConnectionHandle.
    const connection = ctx.get('connection');
    const t = ctx.locale.bind(NS);
    const injected = () => ({ rpc: connection.rpc, t });
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'subscriptions',
        order: 90,
        // A thunk re-evaluated per read, so the nav label follows the active locale.
        label: () => t('nav'),
        inject: injected,
    }, SubscriptionsSection));
    // The image_generate keyed toolview owns how image calls render inline; its
    // gallery bytes ride the same channel through the injected loader. The
    // framework synthesizes the toolview's own `t` seat from `locale: NS`.
    const toolviewInjected = () => ({ load: createImageLoader(connection.rpc) });
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'image_generate',
        locale: NS,
        inject: toolviewInjected,
    }, ImageGenerateToolview));
    // The video_generate keyed toolview plays the saved MP4 inline; its bytes
    // ride the same channel's `video` endpoint through the injected loader.
    const videoToolviewInjected = () => ({ loadVideo: createVideoLoader(connection.rpc) });
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'video_generate',
        locale: NS,
        inject: videoToolviewInjected,
    }, VideoGenerateToolview));
    // The composer Speed toggle (codex fast tier) sits in the right tool row,
    // just left of the model selector; the framework synthesizes its `t` seat
    // from `locale: NS`, and the inject face binds each session's RPC calls.
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'codex-speed',
        order: 0,
        locale: NS,
        inject: (sessionId) => ({
            loadSpeed: createSpeedLoader(connection, sessionId),
            setSpeed: createSpeedSetter(connection, sessionId),
        }),
    }, SpeedSelect));
    // The /fast slash command offers the same Standard/Fast choice as a popup.
    // `available` is synchronous and sees only the session id, so the command
    // stays listed everywhere; `options` throws the friendly gate when the
    // session's current model is not a fast-capable codex model (the same
    // in-popup error posture the /model contribution uses for its guards).
    ctx.inject(['commandUi'], (scope) => {
        const command = scope.get('commandUi');
        scope.effect(() => command.register({
            name: 'fast',
            description: t('commandFast'),
            available: () => true,
            ui: {
                kind: 'popupSelect',
                options: async (session) => {
                    const state = await createSpeedLoader(connection, session.sessionId)();
                    if (!state.visible)
                        throw new Error(t('commandFastUnavailable'));
                    return [
                        { id: 'standard', label: t('speedStandard'), detail: t('speedStandardDescription') },
                        { id: 'fast', label: t('speedFast'), detail: t('speedFastDescription') },
                    ].map(option => ({ ...option, active: option.id === state.tier }));
                },
                onSelect: async (option, session) => {
                    await createSpeedSetter(connection, session.sessionId)(option.id);
                },
            },
        }), 'dsh-plugin-subscriptions: /fast contribution');
    });
}
