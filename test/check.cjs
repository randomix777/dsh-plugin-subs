// Smoke checks: package.json parses, bundles exist and are syntactically valid, no NUL bytes.
// Run with: node test/check.cjs
'use strict';
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { execSync } = require('child_process');

const root = join(__dirname, '..');
let failures = 0;
function assert(cond, msg) {
    if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
    else { console.log(`  OK  ${msg}`); }
}

// 1. package.json parseable and version 1.2.2
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert(pkg.version === '1.2.2', `package.json version is ${pkg.version}`);
assert(Array.isArray(pkg.files), 'package.json has files array');
const allowed = new Set(['lib', 'lib/', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE']);
for (const f of pkg.files) assert(allowed.has(f), `files entry "${f}" is expected`);
assert(!pkg.files.includes('.memsearch'), 'files must not include .memsearch');
assert(!pkg.files.includes('publish'), 'files must not include publish scripts');

// 2. lib/index.js and lib/client.js exist
assert(existsSync(join(root, 'lib', 'index.js')), 'lib/index.js exists');
assert(existsSync(join(root, 'lib', 'client.js')), 'lib/client.js exists');

// 3. No NUL bytes in bundles
for (const name of ['lib/index.js', 'lib/client.js']) {
    const buf = readFileSync(join(root, name));
    const hasNul = buf.some(b => b === 0);
    assert(!hasNul, `${name} has no NUL bytes`);
}

// 4. Syntax check via node --check
for (const name of ['lib/index.js', 'lib/client.js']) {
    try {
        execSync(`node --check ${join(root, name)}`, { stdio: 'pipe' });
        assert(true, `${name} syntax ok`);
    } catch (e) {
        assert(false, `${name} syntax: ${e.stderr?.toString().slice(0, 120)}`);
    }
}

// 5. Key Unicode preserved in index.js
const idx = readFileSync(join(root, 'lib', 'index.js'), 'utf8');
assert(idx.includes('Settings → Subscriptions'), 'arrow in Settings text preserved');
assert(idx.includes('OAuth PKCE →'), 'arrow in OAuth PKCE text preserved');
assert(idx.includes('—'), 'em-dash preserved');

if (failures > 0) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
else { console.log('\nAll checks passed'); }
