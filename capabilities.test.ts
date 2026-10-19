import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseTrackCapabilities, unavailableReason } from "./capabilities.ts";

describe("browser capability parser", () => {
  it("keeps unsupported controls empty instead of inventing them", () => {
    const report = parseTrackCapabilities({ width: { min: 1, max: 1920 }, facingMode: ["user"] });
    assert.equal(report.iso, null);
    assert.equal(report.exposureTime, null);
    assert.equal(report.zoom, null);
    assert.equal(unavailableReason(report, "iso"), "ISO is not exposed. Manual sensor control is unavailable here.");
    assert.equal(unavailableReason(report, "shutter")?.includes("invented"), false);
  });

  it("reads ranges and modes that the device actually lists", () => {
    const report = parseTrackCapabilities({
      zoom: { min: 1, max: 4, step: 0.1 },
      exposureCompensation: { min: -2, max: 2, step: 0.5 },
      whiteBalanceMode: ["continuous", "manual"],
      torch: true,
      iso: { min: 100, max: 100 },
    });
    assert.equal(report.zoom?.max, 4);
    assert.equal(report.exposureCompensation?.min, -2);
    assert.deepEqual(report.whiteBalanceModes, ["continuous", "manual"]);
    assert.equal(report.torch, true);
    assert.equal(report.iso, null);
    assert.equal(unavailableReason(report, "zoom"), null);
  });
});
