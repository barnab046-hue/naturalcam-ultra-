import { runStillPipeline, type PipelineInput, type StillMode } from "./image.ts";

type Job = {
  id: number;
  frames: ArrayBuffer[];
  width: number;
  height: number;
  mode: StillMode;
  blurRadius: number;
  laboratory: boolean;
};

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;
  const input: PipelineInput = {
    frames: job.frames.map((buffer) => new Uint8ClampedArray(buffer)),
    width: job.width,
    height: job.height,
    mode: job.mode,
    blurRadius: job.blurRadius,
    laboratory: job.laboratory,
  };
  try {
    const result = runStillPipeline(input);
    self.postMessage({ id: job.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    self.postMessage({ id: job.id, error: message });
  }
};
