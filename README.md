# TerraGuard

Offline GIS disaster response planner using gpt-oss (open-weight reasoning models).

## Why

Deliver expert evacuation, shelter, and resource plans from preloaded spatial data—no internet required.

## High-level

- Local agent: runs offline on a laptop/field device
- GIS core: reads shapefiles/GeoJSON/GeoTIFF
- Reasoning: gpt-oss models (20B or 120B; quantized for local)
- Targets hackathon categories: For Humanity, Best Local Agent, Most Useful Fine-Tune

## Repo layout

- `app/` Frontend (TBD)
- `backend/` API + reasoning pipeline (TBD)
- `data/` Sample geodata (no PII)
- `models/` Model notes/links/quant configs (no weights committed)
- `scripts/` Utility scripts
- `docs/` Design notes

## Getting started

TBD
EOF

# .gitignore (Node + Python)

cat > .gitignore << 'EOF'

# Node

node_modules/
dist/
.cache/
.next/

# Python

.venv/
**pycache**/
\*.pyc

# General

.DS*Store
.env
.env.*
data/\_.zip
models/\*.gguf
EOF

# Apache-2.0 LICENSE (short way: add via GitHub UI, or drop a placeholder and replace later)

echo "See GitHub → Add file → Choose a license template → Apache License 2.0" > LICENSE.PLACEHOLDER
