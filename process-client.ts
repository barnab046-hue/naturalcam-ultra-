import { runStillPipeline, type PipelineInput, type PipelineResult } from "./image.ts";

type WorkerResponse = { id: number; result?: PipelineResult; error?: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (result: PipelineResult) => void; reject: (error: Error) => void }>();

function ensureWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
    return null;
  }
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const waiting = pending.get(event.data.id);
    if (!waiting) return;
    pending.delete(event.data.id);
    if (event.data.result) waiting.resolve(event.data.result);
    else waiting.reject(new Error(event.data.error || "Processing failed."));
  };
  worker.onerror = () => {
    worker = null;
  };
  return worker;
}

export function processStill(input: PipelineInput): Promise<PipelineResult> {
  const active = ensureWorker();
  if (!active) return Promise.resolve(runStillPipeline(input));
  const id = ++seq;
  const frames = input.frames.map((frame) => frame.slice().buffer);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      active.postMessage({
        id,
        frames,
        width: input.width,
        height: input.height,
        mode: input.mode,
        blurRadius: input.blurRadius ?? 0,
        laboratory: Boolean(input.laboratory),
      });
    } catch (error) {
      pending.delete(id);
      try {
        resolve(runStillPipeline(input));
      } catch (err) {
        reject(err instanceof Error ? err : error);
      }
    }
  });
}
