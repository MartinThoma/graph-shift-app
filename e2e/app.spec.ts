import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** The open graph's saved session (as stored in localStorage). */
async function getSession(page: Page): Promise<{ history: { present: { dot: string; positions: Record<string, { x: number; y: number }> } } } | null> {
  return page.evaluate(() => {
    const library = localStorage.getItem("graph-shift:library:v1");
    if (!library) return null;
    const raw = localStorage.getItem("graph-shift:graph:v1:" + JSON.parse(library).activeId);
    return raw ? JSON.parse(raw) : null;
  });
}

async function getDot(page: Page): Promise<string> {
  return (await getSession(page))?.history.present.dot ?? "";
}

async function getLibrary(page: Page): Promise<{ activeId: string; graphs: { id: string; name: string }[] }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("graph-shift:library:v1")!));
}

async function createShareUrl(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Share" }).click();
  const input = page.getByRole("dialog", { name: "Share link" }).getByRole("textbox", { name: "Share link" });
  await expect(input).toHaveValue(/#share=v1\./);
  const url = await input.inputValue();
  await page.keyboard.press("Escape");
  return url;
}

async function replaceDot(page: Page, dot: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(dot);
  await page.waitForTimeout(500);
}

async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(".cm-content").innerText()).replace(/ /g, " ");
}

async function getNodeCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(`.graph-canvas [data-node-id="${id}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragNode(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const c = await getNodeCenter(page, id);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + (dx * i) / 8, c.y + (dy * i) / 8);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('.graph-canvas [data-node-id="api"]').waitFor();
});

test("dragging a node moves it and its edges without touching the DOT text", async ({ page }) => {
  const before = await getEditorText(page);
  const start = await getNodeCenter(page, "auth");
  const getApiAuthPath = () =>
    page.evaluate(() => {
      const edge = [...document.querySelectorAll(".graph-canvas .edge")].find((e) => e.getAttribute("data-edge-key")!.startsWith("api\u001fauth"));
      return edge!.querySelector("path")!.getAttribute("d");
    });
  const edgePathBefore = await getApiAuthPath();
  await dragNode(page, "auth", 160, 60);
  const end = await getNodeCenter(page, "auth");
  expect(end.x - start.x).toBeGreaterThan(100);
  expect(await getEditorText(page)).toBe(before);
  await expect(page.locator(".lock-state")).toHaveText(/Placed by hand/);
  // Hand-placed markers are off by default and can be switched on (remembered per browser).
  await expect(page.locator(".hand-tick")).toHaveCount(0);
  await page.getByRole("button", { name: "Highlight nodes placed by hand" }).click();
  await expect(page.locator(".hand-tick")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".hand-tick")).toHaveCount(1);
  // The api -> auth edge is re-drawn to the new position.
  expect(await getApiAuthPath()).not.toBe(edgePathBefore);
  await page.getByRole("button", { name: "Highlight nodes placed by hand" }).click();
  await expect(page.locator(".hand-tick")).toHaveCount(0);
});

test("switching layouts after a drag asks first; keeping positions moves nothing", async ({ page }) => {
  await dragNode(page, "auth", 120, 0);
  const placed = await getNodeCenter(page, "auth");
  await page.selectOption("#layout-select", "radial");
  const dialog = page.getByRole("dialog", { name: "Replace hand-placed positions?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep positions" }).click();
  await expect(dialog).toBeHidden();
  expect(await getNodeCenter(page, "auth")).toEqual(placed);
  await expect(page.locator("#layout-select")).toHaveValue("hierarchical");

  await page.selectOption("#layout-select", "radial");
  await page.getByRole("button", { name: "Re-layout" }).click();
  await expect(page.locator("#layout-select")).toHaveValue("radial");
  await expect(page.locator(".lock-state")).toHaveCount(0);
});

test("adding and removing nodes and edges writes back to the DOT text", async ({ page }) => {
  await page.getByRole("button", { name: "Add node" }).click();
  const form = page.getByRole("dialog", { name: "Add node" });
  await form.getByLabel("ID").fill("cache");
  await form.getByLabel(/Label/).fill("Redis cache");
  await form.getByRole("button", { name: "Add node" }).click();
  await expect(page.locator(".cm-content")).toContainText('cache [label="Redis cache"];');

  await page.getByRole("button", { name: "Add edge" }).click();
  await page.locator('.graph-canvas [data-node-id="api"]').click();
  await page.locator('.graph-canvas [data-node-id="cache"]').click();
  await expect(page.locator(".cm-content")).toContainText("api -> cache;");

  // Select and remove the new edge (it is selected after creation).
  await page.getByRole("button", { name: "Remove edge" }).click();
  await expect(page.locator(".cm-content")).not.toContainText("api -> cache");

  await page.locator('.graph-canvas [data-node-id="queue"]').click();
  await page.getByRole("button", { name: "Remove node" }).click();
  const text = await getEditorText(page);
  expect(text).not.toMatch(/\bqueue\b/);
  expect(text).toContain("mailer -> mailer");
  await expect(page.locator('.graph-canvas [data-node-id="queue"]')).toHaveCount(0);

  // Undo restores the node and its edges.
  await page.locator(".graph-canvas").click({ position: { x: 20, y: 20 } });
  await page.keyboard.press("Control+z");
  await expect(page.locator('.graph-canvas [data-node-id="queue"]')).toHaveCount(1);
  await expect(page.locator(".cm-content")).toContainText("orders -> queue");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator('.graph-canvas [data-node-id="queue"]')).toHaveCount(0);
});

test("undoing a drag restores the position and leaves the text alone", async ({ page }) => {
  const start = await getNodeCenter(page, "web");
  const before = await getEditorText(page);
  await dragNode(page, "web", -150, 40);
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await getNodeCenter(page, "web")).toEqual(start);
  expect(await getEditorText(page)).toBe(before);
  await page.getByRole("button", { name: "Redo" }).click();
  expect((await getNodeCenter(page, "web")).x).toBeLessThan(start.x - 100);
});

test("a syntax error keeps the last graph visible and points at the line", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nbroken -> ;");
  await expect(page.locator(".error-slip")).toContainText("Line 29");
  await expect(page.locator('.graph-canvas [data-node-id="api"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Download SVG" })).toBeEnabled();
});

test("editing text after manual placement keeps hand-placed nodes where they are", async ({ page }) => {
  await dragNode(page, "mailer", -200, 0);
  const placed = await getNodeCenter(page, "mailer");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.type(" newnode;");
  await page.locator('.graph-canvas [data-node-id="newnode"]').waitFor();
  expect(await getNodeCenter(page, "mailer")).toEqual(placed);
});

test("positions and text survive a reload", async ({ page }) => {
  await dragNode(page, "orders", -120, 80);
  const placed = await getNodeCenter(page, "orders");
  await page.waitForTimeout(600);
  await page.reload();
  await page.locator('.graph-canvas [data-node-id="orders"]').waitFor();
  expect(await getNodeCenter(page, "orders")).toEqual(placed);
  await expect(page.locator(".lock-state")).toBeVisible();
  expect(await getDot(page)).toContain("digraph checkout");
});

test("Download SVG saves a clean standalone SVG with the current positions", async ({ page }) => {
  await dragNode(page, "db", 100, 0);
  await page.locator('.graph-canvas [data-node-id="db"]').click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download SVG" }).click()]);
  expect(download.suggestedFilename()).toBe("checkout.svg");
  const svg = readFileSync((await download.path())!, "utf8");
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg.match(/class="node"/g)).toHaveLength(7);
  expect(svg.match(/class="edge"/g)).toHaveLength(8);
  expect(svg).not.toMatch(/hand-tick|selected|data-node-id|grid/);
  expect(svg).toContain(">Postgres</text>");
});

test("the app works offline after the first visit", async ({ page, context }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.graph-canvas [data-node-id="api"]').waitFor();
  await dragNode(page, "api", 80, 0);
  await page.getByRole("button", { name: "Add node" }).click();
  await page.getByRole("dialog", { name: "Add node" }).getByRole("button", { name: "Add node" }).click();
  await expect(page.locator(".cm-content")).toContainText("n1;");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download SVG" }).click()]);
  expect(download.suggestedFilename()).toBe("checkout.svg");
  await context.setOffline(false);
});

test("a newer deployed version is detected, cached and applied on Reload without losing work", async ({ page }) => {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await dragNode(page, "auth", 90, 0);
  const placed = await getNodeCenter(page, "auth");
  // Pretend a newer build is deployed: the version payload names a later version.
  await page.route("**/version.json*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: "99991231T000000Z-next" }) }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const update = page.getByRole("button", { name: "Update available — Reload" });
  await expect(update).toBeVisible({ timeout: 20_000 });
  await update.click();
  await page.waitForEvent("load");
  await page.locator('.graph-canvas [data-node-id="auth"]').waitFor();
  expect(await getNodeCenter(page, "auth")).toEqual(placed);
});

test("Shift+click selects several nodes and dragging one moves all, keeping their offsets", async ({ page }) => {
  const before = await getEditorText(page);
  const web0 = await getNodeCenter(page, "web");
  const api0 = await getNodeCenter(page, "api");
  await page.locator('.graph-canvas [data-node-id="web"]').click();
  await page.locator('.graph-canvas [data-node-id="api"]').click({ modifiers: ["Shift"] });
  await expect(page.locator(".selected-node")).toHaveCount(2);
  await dragNode(page, "api", 140, 30);
  const web1 = await getNodeCenter(page, "web");
  const api1 = await getNodeCenter(page, "api");
  expect(web1.x - web0.x).toBeCloseTo(140, 0);
  expect(api1.x - api0.x).toBeCloseTo(140, 0);
  expect(api1.y - web1.y).toBeCloseTo(api0.y - web0.y, 0);
  expect(await getEditorText(page)).toBe(before);
  // Shift+click again removes a node from the selection.
  await page.locator('.graph-canvas [data-node-id="web"]').click({ modifiers: ["Shift"] });
  await expect(page.locator(".selected-node")).toHaveCount(1);
  // One undo restores both.
  await page.locator(".graph-canvas").focus();
  await page.keyboard.press("Control+z");
  expect(await getNodeCenter(page, "web")).toEqual(web0);
  expect(await getNodeCenter(page, "api")).toEqual(api0);
});

test("rectangle select works with Shift+drag and the Select tool, while plain drag still pans", async ({ page }) => {
  const canvas = (await page.locator(".graph-canvas").boundingBox())!;
  const web = await getNodeCenter(page, "web");
  const api = await getNodeCenter(page, "api");
  // Plain drag on the sheet pans: nodes move on screen, nothing gets selected.
  const start = { x: canvas.x + 60, y: canvas.y + 60 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 30, { steps: 5 });
  await page.mouse.up();
  const webPanned = await getNodeCenter(page, "web");
  expect(webPanned.x - web.x).toBeCloseTo(40, 0);
  await expect(page.locator(".selected-node")).toHaveCount(0);

  // Shift+drag around web and api selects both.
  const a = { x: Math.min(webPanned.x, api.x + 40) - 90, y: webPanned.y - 40 };
  const b = { x: Math.max(webPanned.x, api.x + 40) + 90, y: api.y + 30 + 30 };
  await page.keyboard.down("Shift");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await expect(page.locator(".marquee")).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.locator(".selected-node")).toHaveCount(2);
  await expect(page.locator(".inspector h2")).toHaveText("2 nodes");

  // With the Select tool, a plain drag selects instead of panning; zoom still works.
  await page.getByRole("button", { name: "Rectangle select tool" }).click();
  const before = await getNodeCenter(page, "web");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  expect(await getNodeCenter(page, "web")).toEqual(before);
  await expect(page.locator(".selected-node")).toHaveCount(2);
  await page.mouse.move(canvas.x + 300, canvas.y + 300);
  await page.mouse.wheel(0, -300);
  await expect(page.locator(".zoom-level")).not.toHaveText("100%");
});

test("the inspector edits a node's label and colors and writes them to the DOT text", async ({ page }) => {
  await page.locator('.graph-canvas [data-node-id="db"]').click();
  const inspector = page.locator(".inspector");
  await expect(inspector.locator("h2")).toHaveText("db");
  await inspector.getByLabel("Label").fill("Primary DB");
  await inspector.getByLabel("Label").press("Enter");
  await expect(page.locator(".cm-content")).toContainText('db [label="Primary DB", shape=cylinder];');
  // Typical colors are one click away.
  await inspector.getByRole("button", { name: "Fill color" }).click();
  await inspector.getByRole("button", { name: "Fill #fff3bf" }).click();
  await expect(page.locator(".cm-content")).toContainText('fillcolor="#fff3bf"');
  await expect(page.locator(".cm-content")).toContainText('style="rounded,filled"');
  await expect(page.locator('.graph-canvas [data-node-id="db"] path').first()).toHaveAttribute("fill", "#fff3bf");
  // Any color via the custom picker.
  await inspector.getByRole("button", { name: "Text color" }).click();
  await inspector.getByLabel("Custom text color").fill("#7d2412");
  await expect(page.locator(".cm-content")).toContainText('fontcolor="#7d2412"');
  // Colors already used in the graph are offered too.
  await inspector.getByRole("button", { name: "Border color" }).click();
  const used = inspector.getByRole("group", { name: "Border colors" });
  await expect(used).toContainText("In this graph");
  await used.getByRole("button", { name: "Border #7d2412" }).click();
  await expect(page.locator(".cm-content")).toContainText('color="#7d2412"');
  await inspector.getByRole("button", { name: "None" }).click();
  await expect(page.locator(".cm-content")).not.toContainText("fillcolor");
});

test("Arrange lays out only the selected nodes and leaves the rest and the DOT text alone", async ({ page }) => {
  const before = await getEditorText(page);
  const web = await getNodeCenter(page, "web");
  const mailer = await getNodeCenter(page, "mailer");
  const queue0 = await getNodeCenter(page, "queue");
  await page.locator('.graph-canvas [data-node-id="orders"]').click();
  await page.locator('.graph-canvas [data-node-id="db"]').click({ modifiers: ["Shift"] });
  await page.locator('.graph-canvas [data-node-id="queue"]').click({ modifiers: ["Shift"] });
  const inspector = page.locator(".inspector");
  await inspector.getByLabel("Arrange selection").selectOption("grid");
  await inspector.getByRole("button", { name: "Arrange" }).click();
  await expect(page.locator(".status")).toContainText("Arranged 3 nodes with Compact grid");
  expect(await getNodeCenter(page, "web")).toEqual(web);
  expect(await getNodeCenter(page, "mailer")).toEqual(mailer);
  expect(await getNodeCenter(page, "queue")).not.toEqual(queue0);
  expect(await getEditorText(page)).toBe(before);
  await expect(page.locator(".lock-state")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await getNodeCenter(page, "queue")).toEqual(queue0);
});

test("unconnected nodes are collected in a grid, which can be switched off in the layout options", async ({ page }) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await page.keyboard.type(" lonely1; lonely2; lonely3;");
  await page.locator('.graph-canvas [data-node-id="lonely3"]').waitFor();
  const mailer = await getNodeCenter(page, "mailer");
  const lonely = await getNodeCenter(page, "lonely1");
  // The graph is taller than wide, so the grid sits beside it.
  expect(lonely.y > mailer.y || lonely.x > (await getNodeCenter(page, "auth")).x).toBe(true);
  await page.getByRole("button", { name: "Layout options" }).click();
  const checkbox = page.getByRole("checkbox", { name: "Collect unconnected nodes in a grid" });
  await expect(checkbox).toBeChecked();
  await expect(page.getByRole("dialog", { name: "Layout options" })).toContainText("This graph has 3 such nodes.");
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  expect(await getNodeCenter(page, "lonely1")).not.toEqual(lonely);
});

test("a share link carries the whole graph with hand-placed positions and opens as a new graph", async ({ page, browser }) => {
  await dragNode(page, "db", 120, 40);
  const text = await getEditorText(page);
  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share link" });
  const input = dialog.getByRole("textbox", { name: "Share link" });
  await expect(input).toHaveValue(/#share=v1\./);
  await expect(dialog).toContainText("hand-placed positions are included");
  const url = await input.inputValue();

  // Open the link in a fresh browser profile.
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await other.newPage();
  await page2.goto(url);
  await page2.locator('.graph-canvas [data-node-id="db"]').waitFor();
  // The recipient's own sample graph is also called "checkout", so the shared one gets a distinct name.
  await expect(page2.locator(".status")).toContainText("Opened the shared graph “checkout 2”");
  expect(await getEditorText(page2)).toBe(text);
  expect(page2.url()).not.toContain("#share=");
  // The same (rounded) positions as on the sharing side.
  await page2.waitForTimeout(600);
  const shared = (await getSession(page2))!.history.present.positions;
  const original = (await getSession(page))!.history.present.positions;
  for (const id of Object.keys(original)) {
    expect(shared[id].x).toBeCloseTo(original[id].x, -0.5);
    expect(shared[id].y).toBeCloseTo(original[id].y, -0.5);
  }
  // The recipient now has two graphs: their own sample and the shared one, with the sender's ID.
  const library = await getLibrary(page2);
  expect(library.graphs).toHaveLength(2);
  expect(library.activeId).toBe((await getLibrary(page)).activeId);
  await other.close();
});

test("opening a link adds a graph and leaves the open one untouched", async ({ page, browser }) => {
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const sender = await other.newPage();
  await sender.goto("/");
  await sender.locator('.graph-canvas [data-node-id="api"]').waitFor();
  await replaceDot(sender, "digraph roadmap {\n  plan -> build;\n}\n");
  await sender.locator('.graph-canvas [data-node-id="build"]').waitFor();
  const url = await createShareUrl(sender);
  await other.close();

  await replaceDot(page, "digraph mine {\n  keep -> me;\n}\n");
  await page.locator('.graph-canvas [data-node-id="me"]').waitFor();
  await page.goto(url);
  await page.locator('.graph-canvas [data-node-id="build"]').waitFor();
  // The sender never renamed the graph, so its name followed the DOT text.
  await expect(page.getByRole("button", { name: "Graph: roadmap" })).toBeVisible();

  await page.getByRole("button", { name: "Graph: roadmap" }).click();
  const menu = page.getByRole("dialog", { name: "Graphs" });
  await expect(menu).toContainText("2 graphs in this browser");
  // The receiver's own graph took its name from its DOT text too.
  await menu.getByRole("button", { name: /^Open “mine”/ }).click();
  await page.locator('.graph-canvas [data-node-id="me"]').waitFor();
  expect(await getEditorText(page)).toContain("keep -> me");
});

test("a link to a graph this browser has with other content asks before replacing it", async ({ page }) => {
  const url = await createShareUrl(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// local change\n");
  await page.waitForTimeout(600);

  // Cancel changes nothing.
  await page.goto(url);
  const dialog = page.getByRole("dialog", { name: "Replace “checkout”?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".cm-content")).toContainText("// local change");
  expect((await getLibrary(page)).graphs).toHaveLength(1);

  // Keep both adds the shared version as a separate graph.
  await page.goto(url.replace("#", "?again#"));
  await page.getByRole("dialog", { name: "Replace “checkout”?" }).getByRole("button", { name: "Keep both" }).click();
  await expect(page.getByRole("button", { name: "Graph: checkout 2" })).toBeVisible();
  await expect(page.locator(".cm-content")).not.toContainText("// local change");
  expect((await getLibrary(page)).graphs).toHaveLength(2);

  // Replace mine swaps the content in place, and undo brings the local version back.
  await page.getByRole("button", { name: "Graph: checkout 2" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: /^Open “checkout”/ }).click();
  await expect(page.locator(".cm-content")).toContainText("// local change");
  await page.goto(url.replace("#", "?third#"));
  await page.getByRole("dialog", { name: "Replace “checkout”?" }).getByRole("button", { name: "Replace mine" }).click();
  await expect(page.locator(".status")).toContainText("Replaced “checkout”");
  await expect(page.locator(".cm-content")).not.toContainText("// local change");
  expect((await getLibrary(page)).graphs).toHaveLength(2);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".cm-content")).toContainText("// local change");
});

test("opening the same link twice switches to the graph without asking", async ({ page }) => {
  await page.getByRole("button", { name: "Graph: checkout" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: "New graph" }).click();
  await expect(page.getByRole("button", { name: "Graph: Untitled graph" })).toBeVisible();
  const library = await getLibrary(page);
  const checkout = library.graphs.find((g) => g.name === "checkout")!;
  // Build the sample graph's link from the other graph by switching back first.
  await page.getByRole("button", { name: "Graph: Untitled graph" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: /^Open “checkout”/ }).click();
  const url = await createShareUrl(page);
  await page.getByRole("button", { name: "Graph: checkout" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: /^Open “Untitled graph”/ }).click();
  await page.goto(url);
  await expect(page.locator(".status")).toContainText("already had the shared version");
  await expect(page.getByRole("dialog", { name: "Replace “checkout”?" })).toBeHidden();
  expect((await getLibrary(page)).activeId).toBe(checkout.id);
  expect((await getLibrary(page)).graphs).toHaveLength(2);
});

test("graphs can be renamed, keep their ID, and the name survives a reload", async ({ page }) => {
  const { activeId } = await getLibrary(page);
  await page.getByRole("button", { name: "Graph: checkout" }).click();
  const menu = page.getByRole("dialog", { name: "Graphs" });
  await expect(menu).toContainText(activeId);
  const name = menu.getByRole("textbox", { name: "Name" });
  await name.fill("Checkout architecture");
  await name.press("Enter");
  await expect(page.getByRole("button", { name: "Graph: Checkout architecture" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Graph: Checkout architecture" })).toBeVisible();
  expect((await getLibrary(page)).activeId).toBe(activeId);
  // The DOT text keeps its own name, and changing it no longer renames the graph.
  expect(await getEditorText(page)).toContain("digraph checkout");
  await replaceDot(page, "digraph billing {\n  a -> b;\n}\n");
  await page.locator('.graph-canvas [data-node-id="b"]').waitFor();
  await page.waitForTimeout(300);
  await expect(page.getByRole("button", { name: "Graph: Checkout architecture" })).toBeVisible();
});

test("an unnamed graph follows its DOT graph name, which also names the SVG download", async ({ page }) => {
  await replaceDot(page, "digraph billing {\n  a -> b;\n}\n");
  await expect(page.getByRole("button", { name: "Graph: billing" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SVG" }).click();
  expect((await download).suggestedFilename()).toBe("billing.svg");
});

test("text typed right before opening another graph is kept", async ({ page }) => {
  await page.getByRole("button", { name: "Graph: checkout" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: "New graph" }).click();
  await page.getByRole("button", { name: "Graph: Untitled graph" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: /^Open “checkout”/ }).click();
  await page.locator('.graph-canvas [data-node-id="api"]').waitFor();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("// typed just now");
  // Switch away immediately, without waiting for the save debounce.
  await page.getByRole("button", { name: "Graph: checkout" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: /^Open “Untitled graph”/ }).click();
  await page.getByRole("button", { name: "Graph: Untitled graph" }).click();
  await page.getByRole("dialog", { name: "Graphs" }).getByRole("button", { name: /^Open “checkout”/ }).click();
  await expect(page.locator(".cm-content")).toContainText("// typed just now");
});

test("a graph can be deleted after confirmation; the only graph cannot", async ({ page }) => {
  await page.getByRole("button", { name: "Graph: checkout" }).click();
  let menu = page.getByRole("dialog", { name: "Graphs" });
  await expect(menu.getByRole("button", { name: "Delete “checkout”" })).toBeDisabled();
  await menu.getByRole("button", { name: "New graph" }).click();
  await page.getByRole("button", { name: "Graph: Untitled graph" }).click();
  menu = page.getByRole("dialog", { name: "Graphs" });
  await menu.getByRole("button", { name: "Delete “Untitled graph”" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete “Untitled graph”?" });
  await confirm.getByRole("button", { name: "Delete graph" }).click();
  await expect(page.getByRole("button", { name: "Graph: checkout" })).toBeVisible();
  await page.locator('.graph-canvas [data-node-id="api"]').waitFor();
  expect((await getLibrary(page)).graphs.map((g) => g.name)).toEqual(["checkout"]);
});

test("the share link is disabled with an explanation when the graph is too big", async ({ page }) => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648).toString(36);
  const big = `digraph {\n${Array.from({ length: 900 }, () => `  ${"n" + next()} -> ${"m" + next()};`).join("\n")}\n}\n`;
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(big);
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog", { name: "Share link" });
  await expect(dialog.getByRole("note")).toContainText("too big for a share link");
  await expect(dialog.getByRole("button", { name: "Copy link" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Copy DOT text" })).toBeEnabled();
});

test("the info button shows the version and invites feedback on GitHub", async ({ page }) => {
  await page.getByRole("button", { name: "About Graph Shift" }).click();
  const dialog = page.getByRole("dialog", { name: "About Graph Shift" });
  await expect(dialog).toContainText(/Version\s*\d{8}T\d{6}Z-/);
  await expect(dialog.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", "https://github.com/MartinThoma/graph-shift-app");
  await expect(dialog.getByRole("link", { name: "Open an issue on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/MartinThoma/graph-shift-app/issues/new",
  );
  await dialog.getByRole("button", { name: "Check for updates" }).click();
  await expect(dialog.getByRole("status")).toContainText(/latest version|newer version|offline|not available|Could not reach/);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("work saved before graphs had names is kept as the first graph", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    const present = { dot: "digraph legacy {\n  old -> work;\n}\n", engine: "hierarchical", positions: {}, routes: {}, manualNodes: [], hasManualChanges: false };
    localStorage.setItem("graph-shift:session:v1", JSON.stringify({ version: 1, history: { past: [], present, future: [] }, viewport: null, savedAt: 1 }));
  });
  await page.reload();
  await page.locator('.graph-canvas [data-node-id="work"]').waitFor();
  await expect(page.getByRole("button", { name: "Graph: legacy" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("graph-shift:session:v1"))).toBeNull();
  await page.reload();
  await page.locator('.graph-canvas [data-node-id="work"]').waitFor();
  expect((await getLibrary(page)).graphs).toHaveLength(1);
});
