import { test, expect, type Page } from "@playwright/test";
import { fixtures } from "./fixtures";
import { inspect, cleanMetadata } from "../src/services/metadata";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
let f: Awaited<ReturnType<typeof fixtures>>;
test.beforeAll(async () => {
  f = await fixtures();
});
test.beforeEach(async ({ page }) => {
  await page.goto("./");
});
const upload = async (
  page: Page,
  key: keyof typeof f,
  name: string,
  tool = "converter",
) =>
  page
    .getByLabel(
      tool === "converter"
        ? "Upload images to convert"
        : "Upload images to remove metadata",
    )
    .setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(f[key]),
    });
async function downloaded(page: Page, button: () => Promise<unknown>) {
  const promise = page.waitForEvent("download");
  await button();
  const d = await promise;
  const path = await d.path();
  return {
    name: d.suggestedFilename(),
    bytes: new Uint8Array(await readFile(path!)),
  };
}
test("all six cross-format conversions produce real formats, MIME types, preserved dimensions and extensions", async ({
  page,
}) => {
  for (const [input, output] of [
    ["png", "jpg"],
    ["png", "webp"],
    ["jpg", "png"],
    ["jpg", "webp"],
    ["webp", "png"],
    ["webp", "jpg"],
  ] as const) {
    await upload(page, input, `photo.${input}`);
    await page
      .getByRole("button", { name: output.toUpperCase(), exact: true })
      .click();
    await page
      .getByRole("button", { name: "Convert Image", exact: true })
      .click();
    await expect(
      page.getByText("Completed · Format and dimensions verified."),
    ).toBeVisible();
    const result = await downloaded(page, () =>
      page
        .getByRole("button", { name: `Download photo.${output}`, exact: true })
        .click(),
    );
    expect(result.name).toBe(`photo.${output}`);
    expect(inspect(result.bytes)).toMatchObject({
      format: output,
      width: 3,
      height: 2,
    });
    const resultInfo = await page.evaluate(async () => {
      const img = document.querySelector(
        ".result-thumbnail",
      ) as HTMLImageElement;
      const blob = await fetch(img.src).then((r) => r.blob());
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        mime: blob.type,
        pixels: Array.from(ctx.getImageData(0, 0, 3, 2).data),
      };
    });
    expect(resultInfo.mime).toBe(
      output === "jpg" ? "image/jpeg" : `image/${output}`,
    );
    if (input === "png" && output === "webp")
      expect(resultInfo.pixels[7]).toBe(0);
    if (input === "png" && output === "jpg")
      expect(resultInfo.pixels[7]).toBe(255);
    await page.getByRole("button", { name: "Clear all" }).click();
  }
});
test("PNG re-encoding preserves transparency and quality is disabled", async ({
  page,
}) => {
  await upload(page, "png", "alpha.png");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  await expect(page.getByLabel("Image quality")).toBeDisabled();
  await page
    .getByRole("button", { name: "Convert Image", exact: true })
    .click();
  await expect(
    page.getByText("Completed · Format and dimensions verified."),
  ).toBeVisible();
  const alpha = await page.evaluate(async () => {
    const image = document.querySelector(
      ".result-thumbnail",
    ) as HTMLImageElement;
    const bitmap = await createImageBitmap(
      await fetch(image.src).then((r) => r.blob()),
    );
    const c = new OffscreenCanvas(3, 2),
      ctx = c.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return ctx.getImageData(1, 0, 1, 1).data[3];
  });
  expect(alpha).toBe(0);
});
test("transparent JPG conversion uses white by default and the selected custom colour", async ({
  page,
}) => {
  await upload(page, "transparentPng", "transparent.png");
  await page.getByRole("button", { name: "JPG", exact: true }).click();
  for (const colour of ["#ffffff", "#ff0000"]) {
    await page.getByLabel("Transparency background").fill(colour);
    await page
      .getByRole("button", { name: "Convert Image", exact: true })
      .click();
    await expect(
      page.getByText("Completed · Format and dimensions verified."),
    ).toBeVisible();
    const pixel = await page.evaluate(async () => {
      const image = document.querySelector(
        ".result-thumbnail",
      ) as HTMLImageElement;
      const bitmap = await createImageBitmap(
        await fetch(image.src).then((r) => r.blob()),
      );
      const c = new OffscreenCanvas(32, 32),
        ctx = c.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return Array.from(ctx.getImageData(16, 16, 1, 1).data);
    });
    expect(pixel[3]).toBe(255);
    if (colour === "#ffffff")
      expect(pixel.slice(0, 3).every((n) => n >= 250)).toBe(true);
    else {
      expect(pixel[0]).toBeGreaterThan(250);
      expect(pixel[1]).toBeLessThan(5);
      expect(pixel[2]).toBeLessThan(5);
    }
  }
});
test("batch conversion and duplicate-name ZIP download; no processing network requests", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && r.resourceType() !== "websocket")
      requests.push(r.url());
  });
  await page.getByLabel("Upload images to convert").setInputFiles([
    { name: "same.png", mimeType: "image/png", buffer: Buffer.from(f.png) },
    { name: "same.png", mimeType: "image/png", buffer: Buffer.from(f.png) },
  ]);
  await page
    .getByRole("button", { name: "Convert Images", exact: true })
    .click();
  await expect(
    page.getByText("Completed · Format and dimensions verified."),
  ).toHaveCount(2);
  const result = await downloaded(page, () =>
    page.getByRole("button", { name: /Download All as ZIP/ }).click(),
  );
  expect(result.name).toBe("image-toolkit-converted.zip");
  const zip = await JSZip.loadAsync(result.bytes);
  expect(Object.keys(zip.files)).toEqual(["same.webp", "same_2.webp"]);
  expect(requests).toEqual([]);
});
test("independent queues persist across navigation; invalid inputs give readable errors", async ({
  page,
}) => {
  await upload(page, "png", "keep.png");
  await page
    .getByRole("link", { name: "Metadata Remover", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove Metadata", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("link", { name: "Image Converter", exact: true })
    .click();
  await expect(page.getByText("keep.png", { exact: true })).toBeVisible();
  await page
    .getByLabel("Upload images to convert")
    .setInputFiles({
      name: "fake.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake"),
    });
  await expect(page.getByRole("alert")).toContainText("Unsupported image");
  await expect(page.getByText("keep.png", { exact: true })).toBeVisible();
});
test("metadata cleaning for PNG, JPEG and WebP verifies lossless data and ZIP", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "Metadata Remover", exact: true })
    .click();
  await page
    .getByLabel("Upload images to remove metadata")
    .setInputFiles(
      ["metaPng", "metaJpg", "metaWebp"].map((key, i) => ({
        name: `private.${["png", "jpg", "webp"][i]}`,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(f[key as keyof typeof f]),
      })),
    );
  await expect(page.getByText("GPS: Found (1)", { exact: true })).toHaveCount(
    3,
  );
  await page
    .getByRole("button", { name: "Remove Metadata", exact: true })
    .click();
  await expect(page.getByText(/Metadata Removed · Verified/)).toHaveCount(3);
  const result = await downloaded(page, () =>
    page.getByRole("button", { name: /Download All as ZIP/ }).click(),
  );
  expect(result.name).toBe("image-toolkit-cleaned.zip");
  const zip = await JSZip.loadAsync(result.bytes);
  for (const [i, key] of (
    ["metaPng", "metaJpg", "metaWebp"] as const
  ).entries()) {
    const ext = ["png", "jpg", "webp"][i],
      bytes = await zip.file(`private_clean.${ext}`)!.async("uint8array");
    expect(bytes).toEqual(cleanMetadata(f[key]).bytes);
    expect(inspect(bytes).counts.GPS).toBe(0);
  }
});
test("rotated metadata file fails independently while a safe image is cleaned", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "Metadata Remover", exact: true })
    .click();
  await page.getByLabel("Upload images to remove metadata").setInputFiles([
    {
      name: "rotated.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(f.rotatedJpg),
    },
    { name: "safe.png", mimeType: "image/png", buffer: Buffer.from(f.metaPng) },
  ]);
  await page
    .getByRole("button", { name: "Remove Metadata", exact: true })
    .click();
  await expect(
    page.getByText(/Cannot safely remove orientation/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download safe_clean.png", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Download rotated_clean.jpg",
      exact: true,
    }),
  ).toHaveCount(0);
});
test("animated WebP conversion warns, metadata removal preserves animation", async ({
  page,
}) => {
  await upload(page, "animatedMeta", "animated.webp");
  await page
    .getByRole("button", { name: "Convert Image", exact: true })
    .click();
  await expect(
    page.getByText(/Animated images cannot be converted/),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Metadata Remover", exact: true })
    .click();
  await upload(page, "animatedMeta", "animated.webp", "metadata");
  await page
    .getByRole("button", { name: "Remove Metadata", exact: true })
    .click();
  await expect(page.getByText(/Metadata Removed · Verified/)).toBeVisible();
  const result = await downloaded(page, () =>
    page
      .getByRole("button", {
        name: "Download animated_clean.webp",
        exact: true,
      })
      .click(),
  );
  expect(inspect(result.bytes).animated).toBe(true);
  expect(inspect(result.bytes).counts.EXIF).toBe(0);
});
test("EXIF conversion orientation is normalised and output dimensions follow displayed orientation", async ({
  page,
}) => {
  await upload(page, "rotatedJpg", "portrait.jpg");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  await page
    .getByRole("button", { name: "Convert Image", exact: true })
    .click();
  await expect(
    page.getByText("Completed · Format and dimensions verified."),
  ).toBeVisible();
  const result = await downloaded(page, () =>
    page
      .getByRole("button", { name: "Download portrait.png", exact: true })
      .click(),
  );
  expect(inspect(result.bytes)).toMatchObject({ width: 2, height: 3 });
});
test("cancellation stops pending files and another batch can run", async ({
  page,
}) => {
  await page
    .getByLabel("Upload images to convert")
    .setInputFiles(
      Array.from({ length: 25 }, (_, i) => ({
        name: `image${i}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(f.png),
      })),
    );
  await expect(page.getByText("25 images added")).toBeVisible();
  await page
    .getByRole("button", { name: "Convert Images", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel processing", exact: true })
    .click();
  await expect(
    page.getByText("Processing cancelled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Convert Images", exact: true }),
  ).toBeEnabled();
});
test("mobile layout has usable controls and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await upload(
    page,
    "png",
    "A very long descriptive image filename with spaces.png",
  );
  await page
    .getByRole("button", { name: "Convert Image", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Download A very/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
