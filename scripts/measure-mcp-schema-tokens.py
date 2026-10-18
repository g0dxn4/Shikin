"""Count benchmark catalog tokens locally; requires tiktoken==0.12.0 and Node.

These are tokens for the exact compact tools/list JSON, not model input usage,
host tool formatting, cached tokens, or API billing. No model API is called.
"""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess

import tiktoken


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("reports", nargs="+", type=Path)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args()
version = importlib.metadata.version("tiktoken")
if version != "0.12.0":
    raise SystemExit(f"Install pinned tiktoken==0.12.0; found {version}")

# Node reproduces JSON.stringify exactly, including numeric and Unicode syntax.
serializer = """
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
console.log(JSON.stringify(Object.entries(report.catalogs).map(([profile, catalog]) => ({
  profile, text: JSON.stringify(catalog),
  expectedBytes: report.profiles.find(p =>
    `${p.profile}${p.readOnly ? '-read-only' : ''}` === profile).schemaBytes
}))));
"""
encodings = {name: tiktoken.get_encoding(name) for name in ("o200k_base", "cl100k_base")}
results = []
for report_path in args.reports:
    catalogs = json.loads(subprocess.check_output(
        ["node", "--input-type=module", "-e", serializer, "--", str(report_path.resolve())],
        text=True,
    ))
    profiles = []
    for catalog in catalogs:
        encoded = catalog["text"].encode("utf-8")
        if len(encoded) != catalog["expectedBytes"]:
            raise ValueError("Serialized catalog does not match recorded schema byte count")
        profiles.append({
            "profile": catalog["profile"],
            "schemaBytes": len(encoded),
            "schemaSha256": hashlib.sha256(encoded).hexdigest(),
            "tokens": {
                name: len(encoding.encode(catalog["text"], disallowed_special=()))
                for name, encoding in encodings.items()
            },
        })
    results.append({"report": report_path.name, "profiles": profiles})

output = {
    "schemaVersion": "shikin.mcp-schema-tokens.v1",
    "tokenizer": {"package": "tiktoken", "version": version},
    "methodology": "Exact compact JSON.stringify(tools/list) token counts, encoded locally. "
                   "No provider model calls, host formatting, inference, caching or billing measured.",
    "reports": results,
}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
print(json.dumps(output, indent=2))
