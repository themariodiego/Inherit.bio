import { chromium, type Browser, type Page } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firstViewportInteractives } from "../e2e/viewport-controls";

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

async function fixture(run: (page: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/*", route => route.abort());
  try {
    await page.setContent('<main><button>Before</button><div id="widget"></div><button>After</button></main>');
    await page.evaluate(() => {
      document.querySelector("#widget")!.attachShadow({ mode: "open" }).innerHTML =
        '<button>One</button><button>Two</button>';
    });
    await run(page);
  } finally { await page.close(); }
}

describe("first-viewport control census", () => {
  it("counts the inner controls that the previous document-only query omitted", async () => {
    await fixture(async page => {
      expect(await firstViewportInteractives(page)).toEqual(["button:Before", "button:One", "button:Two", "button:After"]);
      expect(await page.locator("body").evaluate(() => document.querySelectorAll("button").length)).toBe(2);
    });
  });

  it("counts nested shadows and a slotted control once, in rendered order", async () => {
    await fixture(async page => {
      await page.evaluate(() => {
        const host = document.querySelector("#widget")!;
        host.innerHTML = '<button slot="action">Slotted</button><button>Not rendered</button>';
        host.shadowRoot!.innerHTML = '<button>One</button><div id="nested"></div><slot name="action"></slot>';
        host.shadowRoot!.querySelector("#nested")!.attachShadow({ mode: "open" }).innerHTML = '<input aria-label="Nested search">';
      });
      expect(await firstViewportInteractives(page)).toEqual(["button:Before", "button:One", "input:Nested search", "button:Slotted", "button:After"]);
    });
  });

  it("keeps navigation and dock exclusions across shadow and slot boundaries", async () => {
    await fixture(async page => {
      await page.evaluate(() => {
        const main = document.querySelector("main")!;
        for (const tag of ["nav", "div"]) {
          const excluded = document.createElement(tag);
          if (tag === "div") excluded.setAttribute("data-copilot-entry", "true");
          excluded.innerHTML = '<button slot="action">Slotted excluded</button>';
          // Custom hosts allow a shadow root while keeping the containing
          // nav/dock outside that root, where native closest cannot see it.
          const host = document.createElement("div");
          host.append(...excluded.childNodes);
          host.attachShadow({ mode: "open" }).innerHTML = '<button>Inner excluded</button><slot name="action"></slot>';
          excluded.append(host); main.prepend(excluded);
        }
        const skip = document.createElement("a"); skip.href = "#main"; skip.textContent = "Skip";
        main.prepend(skip);
      });
      expect(await firstViewportInteractives(page)).toEqual(["button:Before", "button:One", "button:Two", "button:After"]);
    });
  });

  it("applies the same viewport and display boundaries to shadow controls", async () => {
    await fixture(async page => {
      await page.evaluate(() => {
        document.querySelector("#widget")!.shadowRoot!.innerHTML =
          '<button style="display:none">Hidden</button><button style="position:fixed;top:799px">At edge</button>'
          + '<button style="position:fixed;top:800px">Below edge</button>';
      });
      expect(await firstViewportInteractives(page)).toEqual(["button:Before", "button:At edge", "button:After"]);
    });
  });

  it("exposes a real thirteen-control violation without changing the twelve-control ceiling", async () => {
    await fixture(async page => {
      await page.evaluate(() => {
        document.querySelector("#widget")!.shadowRoot!.innerHTML = Array.from({ length: 11 }, (_, i) => `<button>Action ${i}</button>`).join("");
      });
      const controls = await firstViewportInteractives(page);
      expect(controls).toHaveLength(13);
      expect(controls.length).toBeGreaterThan(12);
      // The previous reader would have falsely certified this page as two.
      expect(await page.locator("body").evaluate(() => document.querySelectorAll("button").length)).toBe(2);
    });
  });
});
