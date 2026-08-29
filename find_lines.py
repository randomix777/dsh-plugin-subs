import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('lib/index.js', 'r', encoding='utf8', errors='replace') as f:
    lines = f.readlines()

targets = [
    ('PROVIDER_IDS', 'const PROVIDER_IDS'),
    ('providerIdSchema', 'const providerIdSchema'),
    ('Config providers default', 'providers: z.array(providerIdSchema).default'),
    ('DEFAULT_MODELS agnes', 'agnes: ['),
    ('resolveCatalog agnes', 'agnes: resolve("agnes")'),
    ('accountOf agnes', 'case "agnes"'),
    ('exchange agnes', 'case "agnes": return exchangeAgnesCode'),
    ('persist agnes', 'case "agnes": return saveSession("agnes"'),
    ('apply case agnes', 'case "agnes": {'),
    ('login agnes', '"agnes" ? agnesFlow'),
]

for name, pattern in targets:
    for i, l in enumerate(lines):
        if pattern in l:
            print(f'=== {name} at line {i+1} ===')
            for j in range(i, min(i+6, len(lines))):
                print(f'{j+1}: {lines[j].rstrip()}')
            print()
            break
