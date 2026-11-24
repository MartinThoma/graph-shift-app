import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

async function getDot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("graph-shift:session:v1");
    return raw ? (JSON.parse(raw).history.present.dot as string) : "";
  });
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
