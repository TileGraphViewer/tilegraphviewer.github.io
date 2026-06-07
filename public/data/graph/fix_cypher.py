import re

with open("import.cypher", "r", encoding="utf-8") as f:
    content = f.read()

# Remove quotes around property keys (chỉ keys, không phải values)
fixed = re.sub(r'"(\w+)":', r'\1:', content)

with open("import_fixed.cypher", "w", encoding="utf-8") as f:
    f.write(fixed)

print("Done — saved to import_fixed.cypher")
