export type Justify =
  | "flex-start"
  | "flex-end"
  | "center"
  | "space-between"
  | "space-around"
  | "space-evenly";
export interface LayoutConfig {
  width: number;
  gap: number;
  justify: Justify;
  items: Array<{ basis: number; grow: number; shrink: 0 | 1 }>;
}
export interface Box {
  x: number;
  width: number;
}
export const JUSTIFY: readonly Justify[];
export const modelInfo: Readonly<{
  version: string;
  parameters: number;
  featureVersion: number;
  weightBytes: number;
  brotliBytes: number;
  meanErrorPx: number;
  p95ErrorPx: number;
  maxErrorPx: number;
  trainingLayouts: number;
  testLayouts: number;
}>;
export function createLayoutPredictor(options?: {
  weights?: ArrayBuffer;
}): Promise<(config: LayoutConfig) => Box[]>;
