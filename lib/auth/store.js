/**
 * On-disk OAuth session store at `~/.dsh/plugins/subscriptions/auth.json`.
 *
 * The file is a JSON object keyed by provider id. Writes are atomic
 * (tmp file + rename) with mode 0600 because they carry bearer tokens.
 * Session shapes live here (not in the provider modules) because this file
 * owns the durable format.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
/** Every provider route, in display order. */
export const PROVIDER_IDS = ['codex', 'claude', 'grok', 'copilot', 'antigravity', 'openrouter', 'agnes', 'qwen', 'spark', 'ernie'];
/**
 * Absolute path of the auth store file.
 * @returns `dshHomePath('plugins', 'subscriptions', 'auth.json')`.
 */
export function authFilePath() {
    return dshHomePath('plugins', 'subscriptions', 'auth.json');
}
/** Store location used before the plugin was renamed; migrated on first read. */
function legacyAuthFilePath() {
    return dshHomePath('plugins', 'router', 'auth.json');
}
/** Check that one durable entry carries the fields every session needs. */
function assertSessionShape(provider, value) {
    if (typeof value !== 'object' || value === null) {
        throw new Error(`subscriptions auth store: entry "${provider}" is not an object; fix or delete the store file`);
    }
    const entry = value;
    if (typeof entry.accessToken !== 'string' || entry.accessToken.length === 0
        || typeof entry.refreshToken !== 'string' || entry.refreshToken.length === 0
        || typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt)) {
        throw new Error(`subscriptions auth store: entry "${provider}" is missing accessToken/refreshToken/expiresAt; fix or delete the store file`);
    }
}
/**
 * Read the whole store. A missing file is an empty store; malformed JSON or a
 * malformed entry throws, because silently discarding tokens would strand the
 * user without a diagnosis.
 * @param path - store file path; defaults to {@link authFilePath}.
 * @returns the parsed session map.
 */
export async function loadStore(path = authFilePath()) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
        // Migrate the pre-rename store once, preserving existing logins.
        if (path !== authFilePath())
            return {};
        try {
            text = await readFile(legacyAuthFilePath(), 'utf8');
        }
        catch (legacyError) {
            if (legacyError.code === 'ENOENT')
                return {};
            throw legacyError;
        }
        const migrated = parseStore(text, legacyAuthFilePath());
        await writeStore(migrated, path);
        await rm(legacyAuthFilePath(), { force: true });
        return migrated;
    }
    return parseStore(text, path);
}
/** Parse and validate store JSON read from `path`. */
function parseStore(text, path) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(`subscriptions auth store at ${path} is not valid JSON; fix or delete the file`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`subscriptions auth store at ${path} must be a JSON object keyed by provider; fix or delete the file`);
    }
    const store = parsed;
    for (const provider of PROVIDER_IDS) {
        const entry = store[provider];
        if (entry !== undefined)
            assertSessionShape(provider, entry);
    }
    return store;
}
/** Persist the whole store atomically with owner-only permissions. */
async function writeStore(store, path) {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
        await writeFile(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
        // An existing destination keeps its old mode through rename on some
        // filesystems; enforce 0600 on the source before the swap.
        await chmod(tmp, 0o600);
        await rename(tmp, path);
    }
    catch (error) {
        await rm(tmp, { force: true });
        throw error;
    }
}
/**
 * Read one provider's session.
 * @param provider - the provider route.
 * @param path - store file path; defaults to {@link authFilePath}.
 * @returns the stored session, or `undefined` when logged out.
 */
export async function getSession(provider, path = authFilePath()) {
    return (await loadStore(path))[provider];
}
/**
 * Write one provider's session, preserving the others.
 * @param provider - the provider route.
 * @param session - the fresh session from a login or refresh.
 * @param path - store file path; defaults to {@link authFilePath}.
 */
export async function saveSession(provider, session, path = authFilePath()) {
    const store = await loadStore(path);
    store[provider] = session;
    await writeStore(store, path);
}
/**
 * Delete one provider's session (logout).
 * @param provider - the provider route.
 * @param path - store file path; defaults to {@link authFilePath}.
 */
export async function deleteSession(provider, path = authFilePath()) {
    const store = await loadStore(path);
    if (store[provider] === undefined)
        return;
    delete store[provider];
    await writeStore(store, path);
}
