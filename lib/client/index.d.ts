/**
 * Subscription OAuth login page, browser half. Registers the Subscriptions
 * settings section; every login state fact arrives through the node half's
 * `/subscriptions-auth` RPC channel — this plugin holds no credential state of its
 * own. Section copy rides the client locale service: one 'settings.subscriptions'
 * namespace with zh/en dictionaries, rebound per read so the nav label and
 * page text follow the active locale.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { SubscriptionsKey } from './locales.js';
export type { SubscriptionsSectionInjected, SubscriptionsSectionProps } from './SubscriptionsSection.js';
export type { ImageGenerateToolviewInjected, ImageGenerateToolviewProps } from './ImageGenerateToolview.js';
export type { VideoGenerateToolviewInjected, VideoGenerateToolviewProps } from './VideoGenerateToolview.js';
export type { SpeedSelectInjected, SpeedSelectProps, SpeedState, SpeedTier } from './SpeedSelect.js';
export type { SubscriptionsKey } from './locales.js';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The Subscriptions settings page copy. */
        'settings.subscriptions': SubscriptionsKey;
    }
}
/**
 * Required services (cordis fiber inject): `slots` carries the registration
 * seat, `connection` the `/subscriptions-auth` RPC caller, and `locale` the copy
 * dictionaries.
 */
export declare const inject: string[];
/**
 * Register the Subscriptions section once the `settings.section` declaration
 * is on the ledger (the shell's apply order relative to this one is NOT
 * constrained; registration depends on the slot through `slots.inject()`).
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
