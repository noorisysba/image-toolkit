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
  await page
    .locator(".brand-logo")
    .evaluate((image: HTMLImageElement) => image.decode());
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
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
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
    const c = document.createElement("canvas");
    c.width = 3;
    c.height = 2;
    const ctx = c.getContext("2d")!;
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
    await page
      .getByLabel("Transparency background", { exact: true })
      .fill(colour);
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
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext("2d")!;
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
  await page.getByLabel("Upload images to convert").setInputFiles({
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
  await page.getByLabel("Upload images to remove metadata").setInputFiles(
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
  await page.getByLabel("Upload images to convert").setInputFiles(
    Array.from({ length: 25 }, (_, i) => ({
      name: `image${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from(f.png),
    })),
  );
  await expect(page.getByText("25 images added")).toBeVisible();
  // Keep real native encoding pending long enough to exercise cancellation,
  // including on fast CI machines where tiny fixtures otherwise finish first.
  await page.evaluate(() => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      setTimeout(() => nativeToBlob.call(this, callback, type, quality), 1000);
    };
  });
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
test("preview memory is bounded without resizing downloaded images", async ({
  page,
}) => {
  await upload(page, "largePng", "large.png");
  const inputPreview = page.locator(".thumbnail:visible");
  await expect(inputPreview).toBeVisible();
  expect(
    await inputPreview.evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(96);
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  await page
    .getByRole("button", { name: "Convert Image", exact: true })
    .click();
  await expect(
    page.getByText("Completed · Format and dimensions verified."),
  ).toBeVisible();
  const resultPreview = page.locator(".result-thumbnail");
  await expect(resultPreview).toBeAttached();
  await expect(resultPreview).toHaveJSProperty("naturalWidth", 96);
  const result = await downloaded(page, () =>
    page
      .getByRole("button", { name: "Download large.png", exact: true })
      .click(),
  );
  expect(inspect(result.bytes)).toMatchObject({ width: 640, height: 400 });
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

test("C2PA PNG regression: detected credentials are removed from a valid full-size download", async ({
  page,
}) => {
  const bytes = process.env.REGRESSION_IMAGE
    ? new Uint8Array(await readFile(process.env.REGRESSION_IMAGE))
    : f.contentPng;
  await page
    .getByRole("link", { name: "Metadata Remover", exact: true })
    .click();
  await page.getByLabel("Upload images to remove metadata").setInputFiles({
    name: "credentials.png",
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  });
  await expect(
    page.getByText("Content credentials (C2PA): Found (1)", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Metadata", exact: true })
    .click();
  await expect(
    page.getByText(
      /Metadata Removed · Verified. Removed: C2PA content credentials/,
    ),
  ).toBeVisible();
  const button = page.getByRole("button", {
    name: "Download credentials_clean.png",
    exact: true,
  });
  await expect(button).toHaveCSS(
    "background-color",
    /rgb\((37, 99, 235|29, 78, 216)\)/,
  );
  await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
  const result = await downloaded(page, () => button.click());
  const before = inspect(bytes),
    after = inspect(result.bytes);
  expect(after.counts.C2PA).toBe(0);
  expect(after.unknown).toBe(0);
  expect([after.width, after.height]).toEqual([before.width, before.height]);
  const pixels = (b: Uint8Array) =>
    inspect(b)
      .parts.filter((p) => p.kind === "IDAT")
      .map((p) => Array.from(b.subarray(p.start, p.end)));
  expect(pixels(result.bytes)).toEqual(pixels(bytes));
});
test("unrecognised containers are named without claiming verified removal", async ({
  page,
}) => {
  await page
    .getByRole("link", { name: "Metadata Remover", exact: true })
    .click();
  await upload(page, "unknownPng", "unknown.png", "metadata");
  await expect(
    page.getByText(/Unrecognised structures: 1 \(vpAg\)/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Metadata", exact: true })
    .click();
  await expect(
    page.getByText(/Not verified: no recognised metadata removed/),
  ).toBeVisible();
  await expect(page.getByText(/Metadata Removed · Verified/)).toHaveCount(0);
});
test("JPG info button toggles the exact transparency explanation; text is larger", async ({
  page,
}) => {
  await page.getByRole("button", { name: "JPG", exact: true }).click();
  const explanation =
    "For JPG output, transparent areas will be replaced by the colour you selected, because JPG does not support transparency.";
  await expect(page.getByText(explanation, { exact: true })).toHaveCount(0);
  const info = page.getByRole("button", {
    name: "About transparency background",
    exact: true,
  });
  await info.click();
  await expect(page.getByText(explanation, { exact: true })).toBeVisible();
  await expect(info).toHaveAttribute("aria-expanded", "true");
  await info.press("Enter");
  await expect(page.getByText(explanation, { exact: true })).toHaveCount(0);
  await upload(page, "png", "readable.png");
  await expect(page.getByText("readable.png", { exact: true })).toHaveCSS(
    "font-size",
    "15px",
  );
  await page
    .getByRole("button", { name: "Convert Image", exact: true })
    .click();
  const button = page.getByRole("button", {
    name: "Download readable.jpg",
    exact: true,
  });
  await expect(button).toHaveCSS(
    "background-color",
    /rgb\((37, 99, 235|29, 78, 216)\)/,
  );
  await expect(button.getByText("Download", { exact: true })).toBeVisible();
});
