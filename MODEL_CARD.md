# Model card: refined-v1

## Artifact

- Architecture: 23 → 128 → 128 → 128 → 2, ReLU hidden activations.
- Parameters: 36,354. Hidden weights are per-output-channel signed int8 with float32 scales/biases; output weights remain float32.
- Packed format: NFLX-v2, feature version 4.
- Raw bytes: 39,840. Brotli: 33,801. Gzip: 35,150. These are **weights**, not total package or website size.
- SHA-256: `cf4acc1ceb2d3df3351f00e203918c48cd4d162ec0c774f62549d3f5f6ab1075`.

## Intended use and scope

An experimental learned approximation of a left-to-right, single-row flex container: 1–8 empty items, integer basis 20–320 px, integer grow 0–3, shrink 0/1, gap 0–40 px, six justify modes, and `min-width: 0`. Training widths are 240–1,200 px. The demo can expand to the viewport width and accepts gaps above 40 px. The API permits numerically representable inputs outside the training range for extrapolation experiments; the reported accuracy does not cover those inputs.

No wrapping, nested layout, text/intrinsic measurement, percentage sizing, borders/padding in the layout contract, min/max constraints or full CSS semantics. Predictions can be negative, overlap or overflow; the inference API does not snap or solve them. The demo clamps negative widths only for drawing, while metrics use original predictions.

## Inputs and preprocessing

Version 4 derives dimensions, item properties, prefix/total sums and flags. It canonicalizes irrelevant inputs: shrink becomes 1 when free space is nonnegative; grow becomes 0 when free space is negative; alignment becomes flex-start when grow consumes spare space. These are explicit rules, not learned discoveries. The model still predicts positions and widths; it cannot read the browser reference.

## Training and data

152,000 layouts measured in Chromium 149.0.7827.55: 24,000 initial examples, 96,000 additional natural examples, and 32,000 balanced/invariant examples. Balanced cases cover growing, shrinking, clamped shrinking and no-growth spacing; paired cases are checked against Chromium for equal outputs. The pixel-space Smooth L1 loss gives each layout equal weight. Training uses float stages, simulated quantization, then fixed-integer scale/bias calibration.

Data seeds and SHA-256 hashes are committed under `packages/training/active`. Training examples and runs are generated locally. The original 2,000-layout natural validation set selects checkpoints; a separate 4,000-layout balanced validation set diagnoses tail failures. A new 5,000-layout natural test was evaluated after selection. These are synthetic-family holdouts, not evidence for arbitrary web layouts.

## Evaluation

| Accepted test metric        |     Result |
| --------------------------- | ---------: |
| Combined position/width MAE |  0.3504 px |
| Position MAE                |  0.4122 px |
| Width MAE                   |  0.2886 px |
| p95                         |  1.0836 px |
| Maximum                     | 13.9624 px |
| Coordinates within 1 px     |     94.03% |

Natural validation MAE: 0.3370 px. Wider-container evaluation (1,300–1,800 px): 0.9460 px mean, 76.67 px maximum. The full browser check scored all 5,000 test layouts through the packed artifact; fixtures agree with PyTorch within 0.0003 px. Local warm eight-box CPU inference was about 0.2 ms median; this is hardware-specific inference-only timing, excluding startup and rendering.

## Reproducibility and changes

The exact accepted binary, decoded float export, report and parity fixtures are tracked. `train.py --full` describes the successful stages; continuation creates a separate candidate. No training command automatically replaces the accepted model. Candidate promotion should compare both models on identical data, guard mean and tail errors, check compressed size and browser parity, then use a fresh final test. Existing test cases must not become training replay.
