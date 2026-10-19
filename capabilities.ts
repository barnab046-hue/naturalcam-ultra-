export type ControlRange = { min: number; max: number; step: number };

export type BrowserCameraReport = {
  zoom: ControlRange | null;
  exposureCompensation: ControlRange | null;
  iso: ControlRange | null;
  exposureTime: ControlRange | null;
  colorTemperature: ControlRange | null;
  focusDistance: ControlRange | null;
  whiteBalanceModes: string[];
  focusModes: string[];
  exposureModes: string[];
  torch: boolean;
  pointsOfInterest: boolean;
  facingMode: string[];
  width: ControlRange | null;
  height: ControlRange | null;
  frameRate: ControlRange | null;
};

function asRange(value: unknown): ControlRange | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { min?: unknown; max?: unknown; step?: unknown };
  if (typeof row.min !== "number" || typeof row.max !== "number") return null;
  if (!(row.max > row.min)) return null;
  const step = typeof row.step === "number" && row.step > 0 ? row.step : 0;
  return { min: row.min, max: row.max, step: step > 0 ? step : (row.max - row.min) / 100 };
}

function asModes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function parseTrackCapabilities(raw: unknown): BrowserCameraReport {
  const caps = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    zoom: asRange(caps.zoom),
    exposureCompensation: asRange(caps.exposureCompensation),
    iso: asRange(caps.iso),
    exposureTime: asRange(caps.exposureTime),
    colorTemperature: asRange(caps.colorTemperature),
    focusDistance: asRange(caps.focusDistance),
    whiteBalanceModes: asModes(caps.whiteBalanceMode),
    focusModes: asModes(caps.focusMode),
    exposureModes: asModes(caps.exposureMode),
    torch: caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true)),
    pointsOfInterest: caps.pointsOfInterest === true,
    facingMode: asModes(caps.facingMode),
    width: asRange(caps.width),
    height: asRange(caps.height),
    frameRate: asRange(caps.frameRate),
  };
}

export function unavailableReason(report: BrowserCameraReport, control: string): string | null {
  switch (control) {
    case "zoom":
      return report.zoom ? null : "This camera does not report a zoom range. Nothing is simulated.";
    case "exposure":
      return report.exposureCompensation
        ? null
        : "Exposure compensation is not in this camera's reported controls.";
    case "iso":
      return report.iso ? null : "ISO is not exposed. Manual sensor control is unavailable here.";
    case "shutter":
      return report.exposureTime
        ? null
        : "Shutter time is not exposed. A longer exposure will not be invented.";
    case "whiteBalance":
      return report.whiteBalanceModes.length > 1 || report.colorTemperature
        ? null
        : "White balance modes are not exposed by this browser.";
    case "focus":
      return report.focusModes.length > 0 || report.pointsOfInterest || report.focusDistance
        ? null
        : "Focus control is not exposed. Autofocus may still be running inside the browser.";
    case "torch":
      return report.torch ? null : "No torch or flash is reported for this camera.";
    default:
      return "Unsupported.";
  }
}
