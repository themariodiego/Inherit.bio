import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepared: vi.fn(), embryo: vi.fn(), proof: vi.fn(), change: vi.fn() }));
vi.mock("./prepared-artifact-fixture", () => ({ startPreparedArtifactFixture: mocks.prepared }));
vi.mock("./embryo-browser-fragment-fixture", () => ({ startEmbryoBrowserFragmentFixture: mocks.embryo }));
vi.mock("./prepared-artifact-proof", () => ({ createPreparedArtifactProofWriter: mocks.proof }));
import { startCiArtifactGateway } from "./artifact-gateway-start";

const input = { publicJwk: { kty: "EC", kid: "synthetic-public-key" },
  key: Buffer.from("synthetic-tls-key"), cert: Buffer.from("synthetic-tls-certificate") };
beforeEach(() => {
  vi.clearAllMocks(); mocks.proof.mockImplementation(() => mocks.change);
  mocks.prepared.mockResolvedValue({ close: vi.fn() }); mocks.embryo.mockResolvedValue({ close: vi.fn() });
});
describe("artifact gateway startup ownership", () => {
  it("starts prepared then Embryo without a second exclusive prepared writer", async () => {
    let created = false;
    mocks.proof.mockImplementation(() => {
      if (created) throw Object.assign(new Error("exclusive writer exists"), { code: "EEXIST" });
      created = true; return mocks.change;
    });
    const prepared = await startCiArtifactGateway(3104, input);
    const embryo = await startCiArtifactGateway(3105, input);
    expect(mocks.proof).toHaveBeenCalledTimes(1);
    expect(mocks.prepared).toHaveBeenCalledExactlyOnceWith({ ...input, onChange: mocks.change });
    expect(mocks.embryo).toHaveBeenCalledExactlyOnceWith(input);
    expect(prepared).toBe(await mocks.prepared.mock.results[0].value);
    expect(embryo).toBe(await mocks.embryo.mock.results[0].value);
    expect(input).not.toHaveProperty("onChange");
  });
  it("starts Embryo alone without creating any prepared proof authority", async () => {
    mocks.proof.mockImplementation(() => { throw new Error("prepared writer unavailable"); });
    await expect(startCiArtifactGateway(3105, input)).resolves.toHaveProperty("close");
    expect(mocks.proof).not.toHaveBeenCalled(); expect(mocks.prepared).not.toHaveBeenCalled();
  });
  it("keeps the prepared writer exclusive when prepared startup is repeated", async () => {
    mocks.proof.mockImplementationOnce(() => mocks.change).mockImplementationOnce(() => { throw new Error("exclusive writer exists"); });
    await startCiArtifactGateway(3104, input);
    await expect(startCiArtifactGateway(3104, input)).rejects.toThrow("exclusive writer exists");
    expect(mocks.prepared).toHaveBeenCalledTimes(1); expect(mocks.embryo).not.toHaveBeenCalled();
  });
  it.each([3100, 3103, 3106, NaN])( "refuses unregistered artifact app %s before any starter", async port => {
    await expect(startCiArtifactGateway(port, input)).rejects.toThrow("Exact artifact app variant required");
    expect(mocks.proof).not.toHaveBeenCalled(); expect(mocks.prepared).not.toHaveBeenCalled(); expect(mocks.embryo).not.toHaveBeenCalled();
  });
  it("preserves the prepared proof refusal instead of starting a fallback gateway", async () => {
    mocks.proof.mockImplementation(() => { throw new Error("prepared proof unavailable"); });
    await expect(startCiArtifactGateway(3104, input)).rejects.toThrow("prepared proof unavailable");
    expect(mocks.prepared).not.toHaveBeenCalled(); expect(mocks.embryo).not.toHaveBeenCalled();
  });
});
