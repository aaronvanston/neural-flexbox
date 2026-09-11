/** Decode NFLX-v1: signed packed weights, per-row float32 scales and biases. */
export function decodeModel(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 8 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "NFLX"
  ) {
    throw new Error("Invalid model header");
  }
  const [, featureVersion, bits, count] = bytes.subarray(4, 8);
  if (
    ![1, 2].includes(bytes[4]) ||
    ![3, 4].includes(featureVersion) ||
    ![4, 6, 8].includes(bits) ||
    count < 1 ||
    count > 8
  ) {
    throw new Error("Unsupported model format");
  }
  let offset = 8;
  let previous = 23;
  const layers = [];
  for (let layer = 0; layer < count; layer++) {
    if (offset + 4 > bytes.length)
      throw new Error("Truncated model dimensions");
    const columns = view.getUint16(offset, true);
    const rows = view.getUint16(offset + 2, true);
    offset += 4;
    if (columns !== previous || rows < 1 || rows > 2048)
      throw new Error("Invalid layer dimensions");
    if (bytes[4] === 2 && layer === count - 1) {
      const length = (rows + rows * columns) * 4;
      if (offset + length > bytes.length)
        throw new Error("Truncated float output weights");
      const readFloat = () => {
        const value = view.getFloat32(offset, true);
        offset += 4;
        if (!Number.isFinite(value))
          throw new Error("Invalid model coefficient");
        return value;
      };
      const bias = Array.from({ length: rows }, readFloat);
      const weight = Array.from({ length: rows }, () =>
        Array.from({ length: columns }, readFloat),
      );
      layers.push({ weight, bias });
      previous = rows;
      continue;
    }
    const packedLength = Math.ceil((rows * columns * bits) / 8);
    if (offset + rows * 8 + packedLength > bytes.length)
      throw new Error("Truncated model weights");
    const floats = () =>
      Array.from({ length: rows }, () => {
        const value = view.getFloat32(offset, true);
        offset += 4;
        if (!Number.isFinite(value))
          throw new Error("Invalid model coefficient");
        return value;
      });
    const scales = floats();
    if (scales.some((s) => s <= 0))
      throw new Error("Invalid quantization scale");
    const bias = floats();
    let bitOffset = 0;
    const weight = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: columns }, () => {
        const byte = offset + (bitOffset >> 3);
        const shift = bitOffset & 7;
        const pair =
          bytes[byte] | ((shift + bits > 8 ? bytes[byte + 1] : 0) << 8);
        let integer = (pair >> shift) & ((1 << bits) - 1);
        if (integer & (1 << (bits - 1))) integer -= 1 << bits;
        bitOffset += bits;
        return Math.fround(integer * scales[row]);
      }),
    );
    offset += packedLength;
    layers.push({ weight, bias });
    previous = rows;
  }
  if (offset !== bytes.length || previous !== 2)
    throw new Error("Invalid model length or output shape");
  return { featureVersion, layers };
}
