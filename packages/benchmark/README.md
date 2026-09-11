# Benchmark harnesses

- `npm test`: Node API, artifact hash, invalid inputs, invariance and PyTorch fixture parity.
- `npm run verify`: real Chromium package loading, 100-fixture parity, playground controls and mobile overflow. Start `npm run dev` first; override the endpoint with `VERIFY_BASE_URL` if needed. Screenshots and current evidence go to ignored `artifacts/`.
- `npm run benchmark`: exact accepted weight sizes and a separate Brotli measurement of unminified runtime source. It does not conflate those with a bundled package or website transfer.
- `packages/training/src/evaluate.py`: full generated-dataset metrics with input hash verification. See the training guide for data preparation.

The committed browser metrics describe the original accepted full 5,000-layout evaluation. A current fixture check is not a new full-corpus evaluation. Accuracy and timing claims must name the artifact, dataset and measurement boundary.
