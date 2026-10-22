import { test, expect } from "@playwright/test";
import { fixtures, jpegSegment, text, tiff } from "./fixtures";
import { inspect, join } from "../src/services/metadata";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
let f: Awaited<ReturnType<typeof fixtures>>;
test.beforeAll(async () => {
  f = await fixtures();
});
test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await page
    .locator(".brand-logo")
    .evaluate((img: HTMLImageElement) => img.decode());
});
test("steps are vertical, upload is highlighted, and supplied logo loads", async ({
  page,
}) => {
  const upload = await page.locator(".files-card:visible").boundingBox(),
    settings = await page.locator(".settings-card:visible").boundingBox(),
    results = await page.locator(".results-card:visible").boundingBox();
  expect(settings!.y).toBeGreaterThanOrEqual(upload!.y + upload!.height);
  expect(results!.y).toBeGreaterThanOrEqual(settings!.y + settings!.height);
  await expect(page.locator(".dropzone:visible")).toHaveCSS(
    "background-color",
    "rgb(239, 246, 255)",
  );
  await expect(
    page.getByRole("img", { name: "Image Toolkit", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".brand-logo")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(2172);
  for (const width of [320, 390, 720, 740, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
});
test("all eight EXIF orientations convert to the correct pixel arrangement and unsafe cleaning is refused", async ({
  page,
}) => {
  test.setTimeout(120000);
  const baseline = await page.evaluate(async (bytes) => {
    const bitmap = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
    );
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
  }, Array.from(f.jpg));
  for (let orientation = 1; orientation <= 8; orientation++) {
    const file = join([
      f.jpg.slice(0, 2),
      jpegSegment(0xe1, join([text("Exif\0\0"), tiff(orientation, false)])),
      f.jpg.slice(2),
    ]);
    await page
      .getByLabel("Upload images to convert", { exact: true })
      .setInputFiles({
        name: `orientation-${orientation}.jpg`,
        mimeType: "image/jpeg",
        buffer: Buffer.from(file),
      });
    await page.getByRole("button", { name: "PNG", exact: true }).click();
    await page
      .getByRole("button", { name: "Convert Image", exact: true })
      .click();
    await expect(
      page.getByText("Completed · Format and dimensions verified."),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: `Download orientation-${orientation}.png`,
        exact: true,
      })
      .click();
    const d = await download;
    const bytes = new Uint8Array(await readFile((await d.path())!));
    const size = inspect(bytes);
    expect([size.width, size.height]).toEqual(
      orientation >= 5 ? [2, 3] : [3, 2],
    );
    const actual = await page.evaluate(async (bytes) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    }, Array.from(bytes));
    const expected = new Array<number>(24);
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 3; x++) {
        const [dx, dy] = [
          [],
          [x, y],
          [2 - x, y],
          [2 - x, 1 - y],
          [x, 1 - y],
          [y, x],
          [1 - y, x],
          [1 - y, 2 - x],
          [y, 2 - x],
        ][orientation];
        for (let c = 0; c < 4; c++)
          expected[(dy * size.width + dx) * 4 + c] =
            baseline[(y * 3 + x) * 4 + c];
      }
    expect(actual).toEqual(expected);
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    if (orientation > 1) {
      await page
        .getByRole("link", { name: "Metadata Remover", exact: true })
        .click();
      await page
        .getByLabel("Upload images to remove metadata", { exact: true })
        .setInputFiles({
          name: "rotated.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from(file),
        });
      await page
        .getByRole("button", { name: "Remove Metadata", exact: true })
        .click();
      await expect(
        page.getByText(/Cannot safely remove orientation metadata/),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Download rotated_clean.jpg",
          exact: true,
        }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Clear all", exact: true })
        .click();
      await page
        .getByRole("link", { name: "Image Converter", exact: true })
        .click();
    }
  }
});
test("maximum 50-file batch, overflow rejection, full batch cleaning and unique ZIP entries", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page
    .getByRole("link", { name: "Metadata Remover", exact: true })
    .click();
  await page
    .getByLabel("Upload images to remove metadata", { exact: true })
    .setInputFiles(
      Array.from({ length: 51 }, () => ({
        name: "batch.png",
        mimeType: "image/png",
        buffer: Buffer.from(f.contentPng),
      })),
    );
  await expect(
    page.getByText("50 images added", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("up to 50 files");
  const ids = await page
    .locator(".file-list:visible >li")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-file-id")));
  expect(new Set(ids).size).toBe(50);
  const uploadedHeight = (await page
    .locator(".file-list:visible")
    .boundingBox())!.height;
  expect(uploadedHeight).toBeLessThanOrEqual(361);
  await page
    .getByRole("button", { name: "Remove Metadata", exact: true })
    .click();
  await expect(
    page.locator(".results-card:visible .download-button"),
  ).toHaveCount(50, { timeout: 120000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download All as ZIP/ }).click();
  const d = await download;
  const zip = await JSZip.loadAsync(await readFile((await d.path())!));
  expect(Object.keys(zip.files)).toHaveLength(50);
  expect(zip.file("batch_clean_50.png")).not.toBeNull();
  for (const file of Object.values(zip.files)) {
    const bytes = await file.async("uint8array");
    expect(inspect(bytes).counts.C2PA).toBe(0);
    expect(bytes).toEqual(f.png);
  }
});
test("repeated realistic batches release bitmaps, canvas backing stores and preview URLs", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium",
    "Resource instrumentation and heap sampling are Chromium-specific.",
  );
  test.setTimeout(180000);
  await page.addInitScript(() => {
    const state = {
      liveBitmaps: 0,
      maxBitmaps: 0,
      createdBitmaps: 0,
      urls: new Map<string, number>(),
      canvases: [] as HTMLCanvasElement[],
    };
    (window as unknown as { resourceAudit: typeof state }).resourceAudit =
      state;
    const createBitmap = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      const bitmap = await createBitmap(...args);
      state.liveBitmaps++;
      state.createdBitmaps++;
      state.maxBitmaps = Math.max(state.maxBitmaps, state.liveBitmaps);
      const close = bitmap.close.bind(bitmap);
      let closed = false;
      bitmap.close = () => {
        if (!closed) {
          state.liveBitmaps--;
          closed = true;
        }
        close();
      };
      return bitmap;
    }) as typeof createImageBitmap;
    const createURL = URL.createObjectURL.bind(URL),
      revokeURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = createURL(blob);
      state.urls.set(url, blob instanceof Blob ? blob.size : 0);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      state.urls.delete(url);
      revokeURL(url);
    };
    const createElement = document.createElement.bind(document);
    document.createElement = ((
      ...args: Parameters<Document["createElement"]>
    ) => {
      const element = createElement(...args);
      if (args[0] === "canvas")
        state.canvases.push(element as HTMLCanvasElement);
      return element;
    }) as Document["createElement"];
  });
  await page.reload();
  await page
    .locator(".brand-logo")
    .evaluate((img: HTMLImageElement) => img.decode());
  const raw = new Uint8Array(1024 * 768 * 4);
  let seed = 12345;
  for (let i = 0; i < raw.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    raw[i] = i % 4 === 3 ? 255 : seed >>> 24;
  }
  const image = await sharp(raw, {
    raw: { width: 1024, height: 768, channels: 4 },
  })
    .png()
    .toBuffer();
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const observations: unknown[] = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    await page
      .getByLabel("Upload images to convert", { exact: true })
      .setInputFiles(
        Array.from({ length: 8 }, (_, i) => ({
          name: `noise-${i}.png`,
          mimeType: "image/png",
          buffer: image,
        })),
      );
    await page.getByRole("button", { name: "PNG", exact: true }).click();
    await page
      .getByRole("button", { name: "Convert Images", exact: true })
      .click();
    await expect(
      page.locator(".results-card:visible .download-button"),
    ).toHaveCount(8, { timeout: 90000 });
    const during = await page.evaluate(() => {
      const s = (
        window as unknown as {
          resourceAudit: {
            liveBitmaps: number;
            maxBitmaps: number;
            createdBitmaps: number;
            urls: Map<string, number>;
            canvases: HTMLCanvasElement[];
          };
        }
      ).resourceAudit;
      return {
        liveBitmaps: s.liveBitmaps,
        maxBitmaps: s.maxBitmaps,
        createdBitmaps: s.createdBitmaps,
        urlCount: s.urls.size,
        retainedPreviewBytes: [...s.urls.values()].reduce((a, b) => a + b, 0),
        activeCanvases: s.canvases.filter((c) => c.width || c.height).length,
      };
    });
    expect(during.liveBitmaps).toBe(0);
    expect(during.maxBitmaps).toBe(1);
    expect(during.urlCount).toBe(16);
    expect(during.retainedPreviewBytes).toBeLessThan(1024 * 1024);
    expect(during.activeCanvases).toBe(0);
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              resourceAudit: { urls: Map<string, number> };
            }
          ).resourceAudit.urls.size,
      ),
    ).toBe(0);
    await client.send("HeapProfiler.collectGarbage");
    const metrics = await client.send("Performance.getMetrics");
    observations.push({
      cycle,
      inputBytes: image.length * 8,
      ...during,
      JSHeapUsedSize: metrics.metrics.find((m) => m.name === "JSHeapUsedSize")
        ?.value,
    });
  }
  await testInfo.attach("resource-audit.json", {
    body: JSON.stringify(
      {
        note: "JS heap excludes Blob backing stores, GPU allocations and total process RSS. Resource counters test application-owned lifetimes.",
        observations,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
