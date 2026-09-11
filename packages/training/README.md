# Training and evaluation

Run commands from the repository root. Use Node 22+, Chromium via Playwright, and Python 3.12. PyTorch 2.7.1 and NumPy 2.2.6 match the accepted environment.

## Environment

```sh
npm ci
npx playwright install chromium
python3.12 -m venv .venv
.venv/bin/pip install -r packages/training/requirements.txt
# Alternatively, for the CUDA 12.8 build used by the accepted RTX 3080 run:
.venv/bin/pip install --extra-index-url https://download.pytorch.org/whl/cu128 \
  -r packages/training/requirements-gpu.txt
```

## Data

```sh
npm run data
npm run data:extra
npm run data:balanced
```

These write ignored `data/` JSON and manifests: the original natural train/validation/test/OOD splits, extra natural training data, and balanced training/validation plus the final natural test. Generators use fixed seeds. Re-running overwrites those local files; compare resulting hashes with `active/*manifest.json` before claiming reproduction. Chromium version changes may change labels.

## Continue or reproduce

```sh
# Continue from accepted decoded weights into a separate candidate:
.venv/bin/python packages/training/src/train.py --device cuda --epochs 500
# Reproduce the complete successful recipe from random initialization:
.venv/bin/python packages/training/src/train.py --device cuda --full
```

The full recipe trains the 128-wide model, expands its training corpus, adds balanced cases and equal-layout weighting, trains canonical feature version 4, then applies int8-aware training and fixed-integer calibration. It keeps 36,354 coefficients throughout. Hardware-dependent floating-point differences mean the committed binary remains the authoritative benchmark.

## Package and evaluate a full-recipe candidate

```sh
node packages/training/src/package-model.mjs calibrated8
.venv/bin/python packages/training/src/evaluate.py calibrated8 --target .5 --balanced-test
```

The evaluator records hashes, split-level metrics, a decoded export and PyTorch parity fixtures under ignored `packages/training/runs/calibrated8/candidate`. `--target` records the intended target; the evaluator does not automatically enforce promotion or replace active artifacts. A continuation run is float-only until explicitly quantized using `quantize.py --source ...`; inspect `--help` for options.

Promotion is a reviewable step: check size, compare against active on identical data, inspect per-regime and tail failures, verify browser binary parity, and reserve a fresh final test. Never tune on that final test or silently copy a worse candidate over `active/`. The website is pinned to the accepted hash.

`active/weights-f32.json` is the exact dequantized accepted export for continuation, not an optimizer checkpoint. `active/report.json`, manifests, browser metrics and fixtures describe only the accepted model. Only the accepted artifacts are included.
