import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  fixtures,
  jpegSegment,
  pngChunk,
  text,
  tiff,
  webpChunk,
} from "../../tests/fixtures";
import {
  categories,
  cleanMetadata,
  detectFormat,
  inspect,
  join,
} from "./metadata";
import { outputName, safeName, uniqueName, zipFiles } from "./downloads";
import JSZip from "jszip";
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});
describe("lossless format-aware metadata removal", () => {
  for (const key of ["metaPng", "metaJpg", "metaWebp"] as const) {
    it(`${key}: detects privacy segments, removes them, decodes and preserves exact pixels`, async () => {
      const before = inspect(f[key]);
      expect(before.counts.EXIF).toBe(1);
      expect(before.counts.GPS).toBe(1);
      expect(before.counts.XMP).toBe(1);
      const { bytes, after } = cleanMetadata(f[key]);
      expect(after.format).toBe(before.format);
      expect(after.width).toBe(3);
      expect(after.height).toBe(2);
      for (const category of categories) expect(after.counts[category]).toBe(0);
      const original = await sharp(f[key]).ensureAlpha().raw().toBuffer(),
        result = await sharp(bytes).ensureAlpha().raw().toBuffer();
      expect(result).toEqual(original);
      const imageKinds = ["IDAT", "VP8 ", "VP8L", "entropy"];
      const payload = (b: Uint8Array) =>
        inspect(b)
          .parts.filter((p) => imageKinds.includes(p.kind))
          .map((p) => Array.from(b.subarray(p.start, p.end)));
      expect(payload(bytes)).toEqual(payload(f[key]));
    });
  }
  it("identifies JPEG IPTC and comments and PNG comments/text", () => {
    expect(inspect(f.metaJpg).counts.IPTC).toBe(1);
    expect(inspect(f.metaJpg).counts.Comments).toBe(1);
    expect(inspect(f.metaPng).counts.Comments).toBe(1);
    expect(inspect(f.metaPng).counts.Other).toBe(1);
  });
  for (const key of ["png", "jpg", "webp"] as const)
    it(`${key}: handles files without metadata`, () => {
      const result = cleanMetadata(f[key]);
      expect(result.removed).toBe(0);
      expect(result.bytes).toEqual(f[key]);
    });
  for (const key of ["iccJpg", "iccPng", "iccWebp"] as const)
    it(`${key}: retains colour profiles by default, removes on explicit request`, async () => {
      const keep = cleanMetadata(f[key]),
        drop = cleanMetadata(f[key], true);
      expect(keep.after.profiles).toBeGreaterThan(0);
      expect(drop.after.profiles).toBe(0);
      await expect(sharp(drop.bytes).metadata()).resolves.toMatchObject({
        width: 3,
        height: 2,
      });
    });
  it("rejects rotated JPEG rather than silently altering its orientation", () => {
    expect(() => cleanMetadata(f.rotatedJpg)).toThrow(/orientation/);
  });
  it("rejects invalid EXIF orientation structures", () => {
    const b = join([
      f.jpg.slice(0, 2),
      jpegSegment(0xe1, text("Exif\0\0broken")),
      f.jpg.slice(2),
    ]);
    expect(() => cleanMetadata(b)).toThrow(/orientation/);
  });
  it("rejects rotated PNG and WebP EXIF", () => {
    const png = join([
      f.png.slice(0, 33),
      pngChunk("eXIf", tiff(8)),
      f.png.slice(33),
    ]);
    expect(() => cleanMetadata(png)).toThrow(/orientation/);
    const b = f.metaWebp.slice(),
      p = inspect(b).parts.find((p) => p.kind === "EXIF")!;
    b.set(tiff(8), p.data);
    expect(() => cleanMetadata(b)).toThrow(/orientation/);
  });
  it("rejects XMP orientation changes", () => {
    const b = join([
      f.jpg.slice(0, 2),
      jpegSegment(
        0xe1,
        text(
          'http://ns.adobe.com/xap/1.0/\0<rdf:Description tiff:Orientation="6"/>',
        ),
      ),
      f.jpg.slice(2),
    ]);
    expect(() => cleanMetadata(b)).toThrow(/orientation/);
  });
  it("preserves animation frames and flags while removing WebP metadata", async () => {
    expect(inspect(f.animatedMeta).animated).toBe(true);
    const result = cleanMetadata(f.animatedMeta);
    expect(result.after.animated).toBe(true);
    expect(result.bytes[20] & 12).toBe(0);
    const frames = (b: Uint8Array) =>
      inspect(b)
        .parts.filter((p) => ["ANIM", "ANMF"].includes(p.kind))
        .map((p) => Array.from(b.subarray(p.start, p.end)));
    expect(frames(result.bytes)).toEqual(frames(f.animatedMeta));
    const metadata = await sharp(result.bytes, { animated: true }).metadata();
    expect(metadata.pages).toBe(2);
  });
  it("preserves PNG alpha values exactly", async () => {
    const b = cleanMetadata(f.metaPng).bytes;
    const pixels = await sharp(b).ensureAlpha().raw().toBuffer();
    expect(pixels[7]).toBe(0);
    expect(pixels[11]).toBe(128);
  });
  it("drops trailing bytes outside the image container", () => {
    const trailing = join([f.metaJpg, text("private appended data")]);
    expect(cleanMetadata(trailing).bytes).toEqual(f.jpg);
  });
  it("flags unrecognised ancillary structures instead of claiming a full clean", () => {
    const b = join([
      f.png.slice(0, 33),
      pngChunk("vpAg", text("unknown")),
      f.png.slice(33),
    ]);
    expect(cleanMetadata(b).partial).toBe(true);
  });
  it("removes JFIF embedded thumbnails while preserving JFIF density", () => {
    const header = new Uint8Array(17);
    header.set(text("JFIF\0"));
    header[5] = 1;
    header[6] = 2;
    header[12] = 1;
    header[13] = 1;
    const b = join([
      f.jpg.slice(0, 2),
      jpegSegment(0xe0, header),
      f.jpg.slice(2),
    ]);
    const result = cleanMetadata(b);
    const segment = result.after.parts.find((p) => p.kind === "JFIF")!;
    expect(segment.end - segment.start).toBe(18);
    expect(result.removed).toBe(1);
  });
  it("rejects truncated, bad CRC, unsupported and invalid RIFF containers", () => {
    expect(() => inspect(f.png.slice(0, 40))).toThrow();
    const damaged = f.png.slice();
    damaged[45] ^= 1;
    expect(() => inspect(damaged)).toThrow(/checksum/);
    expect(() => detectFormat(text("not an image"))).toThrow(/Unsupported/);
    expect(() => inspect(f.metaWebp.slice(0, -1))).toThrow();
    expect(() => inspect(f.jpg.slice(0, -2))).toThrow();
  });
  it("rejects PNG unknown critical chunks", () => {
    const b = join([
      f.png.slice(0, 33),
      pngChunk("ABCD", text("unknown")),
      f.png.slice(33),
    ]);
    expect(() => inspect(b)).toThrow(/critical/);
  });
  it("rejects oversized WebP chunks without reading outside the buffer", () => {
    const b = f.metaWebp.slice();
    new DataView(b.buffer).setUint32(16, 0xffffffff, true);
    expect(() => inspect(b)).toThrow();
  });
});
describe("download names and ZIPs", () => {
  it("preserves Unicode and spaces, strips unsafe paths and disambiguates case-insensitively", () => {
    const used = new Set<string>();
    expect(uniqueName("holiday.webp", used)).toBe("holiday.webp");
    expect(uniqueName("holiday.webp", used)).toBe("holiday_2.webp");
    expect(uniqueName("HOLIDAY.webp", used)).toBe("HOLIDAY_3.webp");
    expect(safeName("../a\\b.png")).not.toContain("/");
    expect(outputName("夏 holiday.jpeg", "jpeg", true)).toBe(
      "夏 holiday_clean.jpeg",
    );
  });
  it("generates a real ZIP containing unique filenames and original binary data", async () => {
    const zip = await zipFiles(
      [
        { name: "image.png", blob: new Blob([f.png]) },
        { name: "image.png", blob: new Blob([f.png]) },
      ],
      () => {},
    );
    const archive = await JSZip.loadAsync(await zip.arrayBuffer());
    expect(Object.keys(archive.files)).toEqual(["image.png", "image_2.png"]);
    expect(await archive.file("image.png")!.async("uint8array")).toEqual(f.png);
  });
});
