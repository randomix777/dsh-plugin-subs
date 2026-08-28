/**
 * On-disk discovered-model-catalog cache at
 * `~/.dsh/plugins/subscriptions/models.json` — the durable half of each
 * provider's {@link ModelCatalogCache}. One entry per provider: the last
 * successfully discovered catalog with its fetch time, so capability metadata
 * (reasoning efforts) survives restarts and network failures.
 *
 * Unlike the auth store, this file is a cache: a missing, corrupt, or
 * malformed file silently reads as absent, because the next successful
 * discovery rewrites it. Loads are strictly validated — a malformed entry
 * passed through `resolveModel` would make the harness's metadata validation
 * throw on every call, which is worse than having no fallback at all.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
/**
 * Absolute path of the catalog store file.
 * @returns `dshHomePath('plugins', 'subscriptions', 'models.json')`.
 */
export function modelsFilePath() {
    return dshHomePath('plugins', 'subscriptions', 'models.json');
}
/** Validate one persisted reasoning block, or undefined when malformed. */
function sanitizeReasoning(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const raw = value;
    if (!Array.isArray(raw.efforts) || raw.efforts.length === 0)
        return undefined;
    const seen = new Set();
    const efforts = [];
    for (const entry of raw.efforts) {
        if (typeof entry !== 'object' || entry === null)
            return undefined;
        const effort = entry;
        if (typeof effort.id !== 'string' || effort.id.length === 0
            || typeof effort.name !== 'string' || effort.name.length === 0
            || (effort.description !== undefined && typeof effort.description !== 'string')
            || seen.has(effort.id))
            return undefined;
        seen.add(effort.id);
        efforts.push({
            id: ReasoningEffortId(effort.id),
            name: effort.name,
            ...effort.description === undefined ? {} : { description: effort.description },
        });
    }
    if (raw.defaultEffort !== undefined
        && (typeof raw.defaultEffort !== 'string' || !seen.has(raw.defaultEffort)))
        return undefined;
    return {
        efforts,
        ...raw.defaultEffort === undefined ? {} : { defaultEffort: ReasoningEffortId(raw.defaultEffort) },
    };
}
/** Validate one persisted model, or undefined when malformed. */
function sanitizeModel(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const raw = value;
    if (typeof raw.id !== 'string' || raw.id.length === 0
        || typeof raw.name !== 'string' || raw.name.length === 0
        || (raw.description !== undefined && typeof raw.description !== 'string')
        || (raw.contextWindow !== undefined
            && (typeof raw.contextWindow !== 'number' || !Number.isInteger(raw.contextWindow) || raw.contextWindow <= 0))
        || (raw.priority !== undefined
            && (typeof raw.priority !== 'number' || !Number.isFinite(raw.priority))))
        return undefined;
    const reasoning = raw.reasoning === undefined ? undefined : sanitizeReasoning(raw.reasoning);
    if (raw.reasoning !== undefined && reasoning === undefined)
        return undefined;
    const thinkingType = raw.thinkingType;
    if (thinkingType !== undefined && thinkingType !== 'enabled' && thinkingType !== 'adaptive')
        return undefined;
    const fastTier = raw.fastTier;
    if (fastTier !== undefined && typeof fastTier !== 'boolean')
        return undefined;
    return {
        id: raw.id,
        name: raw.name,
        ...raw.description === undefined ? {} : { description: raw.description },
        ...raw.contextWindow === undefined ? {} : { contextWindow: raw.contextWindow },
        ...raw.priority === undefined ? {} : { priority: raw.priority },
        ...reasoning === undefined ? {} : { reasoning },
        ...thinkingType === undefined ? {} : { thinkingType: thinkingType },
        ...fastTier === undefined ? {} : { fastTier },
    };
}
/**
 * Validate one persisted snapshot. Strict: any malformed field drops the
 * whole snapshot rather than repairing it — the next successful discovery
 * rewrites the entry anyway.
 * @param value - the raw per-provider file entry.
 * @returns the validated snapshot, or undefined when unusable.
 */
export function sanitizeSnapshot(value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const raw = value;
    if (typeof raw.at !== 'number' || !Number.isFinite(raw.at))
        return undefined;
    if (!Array.isArray(raw.models) || raw.models.length === 0)
        return undefined;
    const seen = new Set();
    const models = [];
    for (const entry of raw.models) {
        const model = sanitizeModel(entry);
        if (model === undefined || seen.has(model.id))
            return undefined;
        seen.add(model.id);
        models.push(model);
    }
    return { at: raw.at, models };
}
/** Read the whole file; missing or unparsable reads as an empty cache. */
async function readCatalogFile(path) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch {
        return {};
    }
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return {};
        return parsed;
    }
    catch {
        return {};
    }
}
/** Persist the whole file atomically (tmp file + rename). */
async function writeCatalogFile(store, path) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
        await writeFile(tmp, JSON.stringify(store, null, 2));
        await rename(tmp, path);
    }
    catch (error) {
        await rm(tmp, { force: true });
        throw error;
    }
}
/**
 * Build the durable half of one provider's catalog cache over the shared
 * models.json file (concurrent writers are last-writer-wins, acceptable for
 * a cache).
 * @param provider - the provider route keying the file entry.
 * @param path - store file path; defaults to {@link modelsFilePath}.
 * @returns the persistence hooks for {@link ModelCatalogCache}.
 */
export function catalogStore(provider, path = modelsFilePath()) {
    return {
        async load() {
            return sanitizeSnapshot((await readCatalogFile(path))[provider]);
        },
        async save(snapshot) {
            const store = await readCatalogFile(path);
            store[provider] = snapshot;
            await writeCatalogFile(store, path);
        },
        async clear() {
            const store = await readCatalogFile(path);
            if (store[provider] === undefined)
                return;
            delete store[provider];
            await writeCatalogFile(store, path);
        },
    };
}
