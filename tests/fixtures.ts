import sharp from "sharp";
import { crc32, join } from "../src/services/metadata";
export const text = (s: string) => new TextEncoder().encode(s);
export function pngChunk(kind: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length),
    v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(text(kind), 4);
  out.set(data, 8);
  v.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}
export function jpegSegment(marker: number, data: Uint8Array) {
  const out = new Uint8Array(4 + data.length);
  out[0] = 255;
  out[1] = marker;
  new DataView(out.buffer).setUint16(2, data.length + 2);
  out.set(data, 4);
  return out;
}
export function webpChunk(kind: string, data: Uint8Array) {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  out.set(text(kind));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}
export function tiff(orientation = 1, gps = true) {
  const b = new Uint8Array(gps ? 50 : 26),
    v = new DataView(b.buffer);
  b.set(text("II"));
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, gps ? 2 : 1, true);
  v.setUint16(10, 0x112, true);
  v.setUint16(12, 3, true);
  v.setUint32(14, 1, true);
  v.setUint16(18, orientation, true);
  if (gps) {
    v.setUint16(22, 0x8825, true);
    v.setUint16(24, 4, true);
    v.setUint32(26, 1, true);
    v.setUint32(30, 38, true);
    v.setUint16(38, 0, true);
  }
  return b;
}
export async function fixtures() {
  const raw = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 255, 255, 0, 255, 255, 0, 255,
    0, 0, 255, 255, 255,
  ]);
  const base = () => sharp(raw, { raw: { width: 3, height: 2, channels: 4 } });
  const png = new Uint8Array(await base().png().toBuffer()),
    jpg = new Uint8Array(
      await base().flatten({ background: "#ffffff" }).jpeg().toBuffer(),
    ),
    webp = new Uint8Array(await base().webp({ lossless: true }).toBuffer());
  const metaPng = join([
    png.slice(0, 33),
    pngChunk("eXIf", tiff()),
    pngChunk("tEXt", text("Author\0Test Photographer")),
    pngChunk(
      "iTXt",
      text("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta>Test</x:xmpmeta>"),
    ),
    pngChunk("tEXt", text("Comment\0private comment")),
    png.slice(33),
  ]);
  const jpegMetadata = [
    jpegSegment(0xe1, join([text("Exif\0\0"), tiff()])),
    jpegSegment(
      0xe1,
      text("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Test</x:xmpmeta>"),
    ),
    jpegSegment(0xed, text("Photoshop 3.0\0IPTC author")),
    jpegSegment(0xfe, text("private comment")),
  ];
  const metaJpg = join([jpg.slice(0, 2), ...jpegMetadata, jpg.slice(2)]);
  function extendWebp(extras: Uint8Array[], flags = 12) {
    const vx = new Uint8Array(10);
    vx[0] = flags;
    vx[4] = 2;
    vx[7] = 1;
    const out = join([
      webp.slice(0, 12),
      webpChunk("VP8X", vx),
      webp.slice(12),
      ...extras,
    ]);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    return out;
  }
  const metaWebp = extendWebp([
    webpChunk("EXIF", tiff()),
    webpChunk("XMP ", text("<x:xmpmeta>Test</x:xmpmeta>")),
  ]);
  const rotatedJpg = join([
    jpg.slice(0, 2),
    jpegSegment(0xe1, join([text("Exif\0\0"), tiff(6, false)])),
    jpg.slice(2),
  ]);
  const iccJpg = new Uint8Array(
    await base()
      .flatten({ background: "#fff" })
      .withIccProfile("srgb")
      .jpeg()
      .toBuffer(),
  );
  const iccPng = new Uint8Array(
    await base().withIccProfile("srgb").png().toBuffer(),
  );
  const iccWebp = new Uint8Array(
    await base().withIccProfile("srgb").webp().toBuffer(),
  );
  // Two full animation frames, generated from raw RGBA pixels with libwebp via sharp.
  const secondFrame = Buffer.from(raw);
  secondFrame[0] = 0;
  secondFrame[1] = 255;
  const animated = new Uint8Array(
    await sharp(Buffer.concat([raw, secondFrame]), {
      raw: { width: 3, height: 4, channels: 4, pageHeight: 2 },
    })
      .webp({ loop: 0, delay: [100, 100], lossless: true })
      .toBuffer(),
  );
  const animatedMeta = join([
    animated,
    webpChunk("EXIF", tiff()),
    webpChunk("XMP ", text("<x:xmpmeta>animation</x:xmpmeta>")),
  ]);
  new DataView(animatedMeta.buffer).setUint32(4, animatedMeta.length - 8, true);
  animatedMeta[20] |= 12;
  const transparentPng = new Uint8Array(
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer(),
  );
  const largePng = new Uint8Array(
    await sharp({
      create: {
        width: 640,
        height: 400,
        channels: 4,
        background: { r: 20, g: 70, b: 130, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer(),
  );
  return {
    png,
    jpg,
    webp,
    metaPng,
    metaJpg,
    metaWebp,
    rotatedJpg,
    iccJpg,
    iccPng,
    iccWebp,
    animated,
    animatedMeta,
    transparentPng,
    largePng,
  };
}
