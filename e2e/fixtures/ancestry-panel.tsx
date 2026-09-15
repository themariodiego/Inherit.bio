import { createRoot } from "react-dom/client";
import { AncestryRegions, type AncestryRegionsProps } from "../../src/components/results/ancestry/ancestry-regions";
import { RegionalAncestryRegions, type RegionalAncestryRegionsProps } from "../../src/components/results/ancestry/regional-ancestry-regions";

type Fixture = { kind: "legacy"; props: AncestryRegionsProps } | { kind: "regional"; props: RegionalAncestryRegionsProps };

/** Only the actual components run in the browser; synthetic view props come from the test. */
export function renderFixture(fixture: Fixture) {
  createRoot(document.getElementById("root")!).render(
    <main tabIndex={-1}>
      <header><h1>Ancestry</h1><button type="button"><span>Other control</span></button></header>
      {fixture.kind === "legacy" ? <AncestryRegions {...fixture.props} /> : <RegionalAncestryRegions {...fixture.props} />}
    </main>,
  );
}
