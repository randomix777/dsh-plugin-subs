import sys
sys.stdout.reconfigure(encoding='utf-8')
with open('lib/index.js','r',encoding='utf8',errors='replace') as f: content=f.read()

checks = [
    ('PROVIDER_IDS has glm', 'glm' in content and 'spark' in content and 'ernie' in content),
    ('providerIdSchema has glm', 'glm' in content and 'spark' in content),
    ('glmFlow defined', 'glmFlow' in content),
    ('sparkFlow defined', 'sparkFlow' in content),
    ('ernieFlow defined', 'ernieFlow' in content),
    ('exchangeGlmCode', 'exchangeGlmCode' in content),
    ('exchangeSparkCode', 'exchangeSparkCode' in content),
    ('exchangeErnieCode', 'exchangeErnieCode' in content),
    ('GlmAdapter', 'GlmAdapter' in content),
    ('SparkAdapter', 'SparkAdapter' in content),
    ('ErnieAdapter', 'ErnieAdapter' in content),
    ('refreshGlm', 'refreshGlm' in content),
    ('refreshSpark', 'refreshSpark' in content),
    ('refreshErnie', 'refreshErnie' in content),
    ('GLM_MODELS', 'GLM_MODELS' in content),
    ('SPARK_MODELS', 'SPARK_MODELS' in content),
    ('ERNIE_MODELS', 'ERNIE_MODELS' in content),
    ('case "glm": return saveSession', 'case "glm": return saveSession("glm"' in content),
    ('case "spark": return saveSession', 'case "spark": return saveSession("spark"' in content),
    ('case "ernie": return saveSession', 'case "ernie": return saveSession("ernie"' in content),
]

all_ok = True
for name, ok in checks:
    status = "OK" if ok else "MISSING"
    if not ok:
        all_ok = False
    print(f'{name}: {status}')

print()
print("ALL OK" if all_ok else "ISSUES FOUND")
