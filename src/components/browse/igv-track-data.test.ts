import { describe, expect, it } from "vitest";
import {
  createLoadedTrack, observeTrackText,
  type TrackFeature, type TrackTextBrowser, type TrackTextSnapshot,
} from "./igv-track-data";

function fixture() {
  const loaded = createLoadedTrack([{ rsid: 7, chrom: 15, pos: 101, ref: "A", alt: "G", genotype: "A/G" }]);
  const listeners = new Map<string, Set<() => void>>();
  const pending: { resolve(features: TrackFeature[]): void; reject(error: Error): void }[] = [];
  const snapshots: TrackTextSnapshot[] = [];
  const frame = { chr: "chr15", start: 0, bpPerPixel: 1, getLocusString: () => `chr15:${frame.start + 1}-${frame.start + 200}` };
  const browser: TrackTextBrowser = {
    trackViews: [{ track: { config: { id: "calls" }, getFeatures: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
      viewports: [{ referenceFrame: frame, getWidth: () => 200 }] }],
    on: (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
    un: (name, callback) => { listeners.get(name)?.delete(callback); },
  };
  const stop = observeTrackText(browser, "calls", { chromosome: "chr15", start: 1, end: 200, rows: loaded.rows }, snapshot => snapshots.push(snapshot));
  const change = () => { for (const callback of listeners.get("locuschange") ?? []) callback(); };
  return { browser, loaded, listeners, pending, snapshots, frame, change, stop };
}

const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };

describe("track text snapshot ownership", () => {
  it("ignores a slow earlier view and never overwrites the latest native range", async () => {
    const f = fixture(); await flush();
    f.frame.start = 1000; f.change(); await flush();
    f.pending[1].resolve([]); await flush();
    expect(f.snapshots.at(-1)).toMatchObject({ status: "ready", views: [{ range: "chr15:1001-1200", rows: [], outsideLoadedRange: true }] });
    const count = f.snapshots.length;
    f.pending[0].resolve(f.loaded.features); await flush();
    expect(f.snapshots).toHaveLength(count);
    f.stop();
  });

  it("unsubscribes the same instance callbacks and suppresses reads completing after disposal", async () => {
    const f = fixture(); await flush();
    f.stop(); const count = f.snapshots.length;
    expect([...f.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    f.pending[0].resolve(f.loaded.features); await flush();
    f.change(); await flush();
    expect(f.snapshots).toHaveLength(count);
    expect(f.pending).toHaveLength(1);
  });

  it("clears prior rows on a failed read and refuses an unknown native feature", async () => {
    const f = fixture(); await flush();
    f.pending[0].resolve(f.loaded.features); await flush();
    expect(f.snapshots.at(-1)?.views[0].rows).toHaveLength(1);
    f.change(); await flush(); f.pending[1].reject(new Error("synthetic rejection")); await flush();
    expect(f.snapshots.at(-1)).toEqual({ status: "error", views: [] });
    f.change(); await flush(); f.pending[2].resolve([{ chr: "chr15", start: 100, end: 101, name: "unknown" }]); await flush();
    expect(f.snapshots.at(-1)).toEqual({ status: "error", views: [] });
    f.browser.trackViews[0].track.getFeatures = () => { throw new Error("synthetic synchronous failure"); };
    f.change(); await flush();
    expect(f.snapshots.at(-1)).toEqual({ status: "error", views: [] });
    f.stop();
  });

  it("keeps duplicate-position source rows distinct without exposing identity metadata in popovers", () => {
    const variant = { rsid: null, chrom: 23, pos: 101, ref: null, alt: null, genotype: "--" };
    const loaded = createLoadedTrack([variant, variant]);
    expect(loaded.features.map(feature => feature.chr)).toEqual(["chrX", "chrX"]);
    expect(loaded.features.map(feature => loaded.rows.get(feature)?.key)).toEqual(["23:101:0", "23:101:1"]);
    expect(Object.keys(loaded.features[0])).toEqual(["chr", "start", "end", "name"]);
  });
});
