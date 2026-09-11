# Architecture

`createLayoutPredictor()` loads the packed model once and returns a synchronous function. The browser uses fetch; Node reads the adjacent asset. Each call validates inputs, computes versioned per-item features, and evaluates shared dense layers. Coefficients are compiled into contiguous Float64Arrays, and scratch buffers are reused. Accumulation order matches the reference JavaScript implementation.

The 23 inputs include container/item dimensions, justify indicators, total/prefix basis, grow and weighted shrink sums, and free-space-related flags. Version 4 canonicalizes inactive inputs before encoding. No DOM measurements enter this path. CPU inference is used because dispatch overhead is unnecessary for 1–8 items; training can use CUDA.

NFLX-v2 begins with magic, format version, feature version, weight bit width and layer count. Each layer has uint16 dimensions. Hidden layers store float32 row scales, float32 biases and signed packed integer weights. The final layer stores float32 biases and weights. The decoder checks shape, lengths and finite values. The accepted model uses int8 hidden weights.

The website draws browser-reference elements and model elements separately. A DOM measurement pass computes visible error only after prediction. Gap overlays and controls are presentation tools; they do not feed measured values into inference. Pointer updates are coalesced to animation frames. The live timing is inference-only, not frame duration.

The training package uses Chromium as an offline teacher. Python transforms the saved raw features with the same feature-version contract, trains candidates on pixel-space loss, and exports decoded JSON plus packed binary. Evaluation checks dataset hashes and records metrics and parity fixtures. The active directory contains only accepted artifacts; runs and generated data are ignored.

The playground displays per-box largest edge error: `max(abs(predictedLeft - actualLeft), abs(predictedRight - actualRight))`. Its live mean averages those per-box errors. Selected-box details separately label position and width errors. This UI metric is distinct from the accepted model card’s combined position/width MAE; the model and benchmark have not changed. A single dot field covers the measuring surface, masked under reference boxes and hatched CSS gaps. Surface clipping contains overflow without clipping the external resize handles.

The playground can expand beyond the text column to the viewport edges. Gap input has no training-range cap; the runtime accepts positive finite widths and nonnegative finite gaps while the UI identifies inputs outside the training range. Tooltips sit inside the stage, and square reference/prediction corners preserve the disagreement geometry.
