/** Container surgery only: compressed pixels, animation and rendering chunks are retained. */
export type Format = "png" | "jpg" | "webp";
export type Category =
  | "EXIF"
  | "GPS"
  | "XMP"
  | "IPTC"
  | "Comments"
  | "C2PA"
  | "Other";
export const categories: Category[] = [
  "EXIF",
  "GPS",
  "XMP",
  "IPTC",
  "Comments",
  "C2PA",
  "Other",
];
export const mime: Record<Format, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};
type Part = {
  start: number;
  end: number;
  data: number;
  kind: string;
  category?: Category;
  profile?: boolean;
};
export type Inspection = {
  format: Format;
  width: number;
  height: number;
  animated: boolean;
  counts: Record<Category, number>;
  profiles: number;
  unknown: number;
  unknownKinds: string[];
  orientationSafe: boolean;
  parts: Part[];
  end: number;
};
const ascii = (b: Uint8Array, s: number, n: number) =>
  String.fromCharCode(...b.subarray(s, s + n));
const fail = (message = "Malformed or truncated image container."): never => {
  throw new Error(message);
};
export function detectFormat(b: Uint8Array): Format {
  if (
    b.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)
  )
    return "png";
  if (b[0] === 255 && b[1] === 216) return "jpg";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return fail("Unsupported image. Choose a genuine PNG, JPG or WebP file.");
}
const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const n of b) c = table[(c ^ n) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// Read only structural TIFF fields. Metadata values and coordinates are never logged/displayed.
function exifInfo(b: Uint8Array): { safe: boolean; gps: boolean } {
  try {
    if (ascii(b, 0, 6) === "Exif\0\0") b = b.subarray(6);
    const little = ascii(b, 0, 2) === "II";
    if (!little && ascii(b, 0, 2) !== "MM") throw 0;
    const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (d.getUint16(2, little) !== 42) throw 0;
    const offset = d.getUint32(4, little);
    if (offset < 8 || offset + 2 > b.length) throw 0;
    const count = d.getUint16(offset, little);
    if (offset + 2 + count * 12 + 4 > b.length) throw 0;
    let safe = true,
      gps = false;
    for (let i = 0; i < count; i++) {
      const p = offset + 2 + i * 12,
        tag = d.getUint16(p, little);
      if (tag === 0x112) {
        if (
          d.getUint16(p + 2, little) !== 3 ||
          d.getUint32(p + 4, little) !== 1
        )
          throw 0;
        const o = d.getUint16(p + 8, little);
        safe = safe && o === 1;
      }
      if (tag === 0x8825) gps = true;
    }
    return { safe, gps };
  } catch {
    return { safe: false, gps: false };
  }
}
export function inspect(b: Uint8Array): Inspection {
  const format = detectFormat(b),
    view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info: Inspection = {
    format,
    width: 0,
    height: 0,
    animated: false,
    counts: {
      EXIF: 0,
      GPS: 0,
      XMP: 0,
      IPTC: 0,
      Comments: 0,
      C2PA: 0,
      Other: 0,
    },
    profiles: 0,
    unknown: 0,
    unknownKinds: [],
    orientationSafe: true,
    parts: [],
    end: b.length,
  };
  function add(p: Part) {
    if (p.category) info.counts[p.category]++;
    if (p.profile) info.profiles++;
    if (p.category === "EXIF") {
      const e = exifInfo(
        b.subarray(p.data, p.end - (format === "png" ? 4 : 0)),
      );
      info.orientationSafe &&= e.safe;
      if (e.gps) info.counts.GPS++;
    }
    if (p.category === "XMP") {
      const text = new TextDecoder().decode(b.subarray(p.data, p.end));
      const matches = [
        ...text.matchAll(/(?:[\w-]+:)?Orientation(?:\s*=\s*["']|\s*>)(\d+)/gi),
      ];
      if (matches.some((m) => Number(m[1]) !== 1)) info.orientationSafe = false;
    }
    info.parts.push(p);
  }
  if (format === "png") {
    let p = 8,
      ended = false,
      idat = false;
    while (p < b.length) {
      if (p + 12 > b.length) fail();
      const n = view.getUint32(p),
        end = p + 12 + n;
      if (end > b.length) fail();
      const kind = ascii(b, p + 4, 4);
      if (!/^[a-zA-Z]{4}$/.test(kind)) fail();
      if (crc32(b.subarray(p + 4, end - 4)) !== view.getUint32(end - 4))
        fail("PNG checksum mismatch. The file may be damaged.");
      if (p === 8 && (kind !== "IHDR" || n !== 13)) fail();
      if (kind === "IHDR") {
        if (p !== 8) fail();
        info.width = view.getUint32(p + 8);
        info.height = view.getUint32(p + 12);
      }
      if (kind === "IDAT") idat = true;
      if (kind === "acTL") info.animated = true;
      const text = ["tEXt", "zTXt", "iTXt"].includes(kind);
      const keyword = text
        ? ascii(b, p + 8, Math.min(n, 80)).split("\0")[0]
        : "";
      if (
        /xmp/i.test(keyword) &&
        (kind === "zTXt" ||
          (kind === "iTXt" && b[p + 8 + keyword.length + 1] === 1))
      )
        info.orientationSafe = false;
      let category: Category | undefined =
        kind === "caBX"
          ? "C2PA"
          : kind === "eXIf"
            ? "EXIF"
            : text
              ? /xmp/i.test(keyword)
                ? "XMP"
                : /comment/i.test(keyword)
                  ? "Comments"
                  : "Other"
              : ["tIME", "dSIG"].includes(kind)
                ? "Other"
                : undefined;
      // Legacy raw EXIF text may carry orientation; refusing it is safer than changing display.
      if (text && /raw profile type (exif|iptc)/i.test(keyword))
        info.orientationSafe = false;
      const known = [
        "IHDR",
        "PLTE",
        "IDAT",
        "IEND",
        "tRNS",
        "cHRM",
        "gAMA",
        "iCCP",
        "sBIT",
        "sRGB",
        "bKGD",
        "hIST",
        "pHYs",
        "sPLT",
        "acTL",
        "fcTL",
        "fdAT",
        "cICP",
        "mDCV",
        "cLLI",
        "sTER",
      ];
      if (!category && !known.includes(kind)) {
        if (kind[0] === kind[0].toUpperCase())
          fail("Unknown critical PNG chunk; safe processing is unavailable.");
        info.unknown++;
        if (!info.unknownKinds.includes(kind)) info.unknownKinds.push(kind);
      }
      add({
        start: p,
        end,
        data: p + 8,
        kind,
        category,
        profile: kind === "iCCP",
      });
      p = end;
      if (kind === "IEND") {
        if (n !== 0) fail();
        ended = true;
        info.end = p;
        break;
      }
    }
    if (!ended || !idat) fail();
  } else if (format === "webp") {
    if (b.length < 20 || view.getUint32(4, true) + 8 !== b.length)
      fail("Invalid WebP RIFF length.");
    let p = 12,
      hasImage = false;
    while (p < b.length) {
      if (p + 8 > b.length) fail();
      const kind = ascii(b, p, 4),
        n = view.getUint32(p + 4, true),
        end = p + 8 + n + (n % 2);
      if (end > b.length) fail();
      if (kind === "VP8X") {
        if (n !== 10 || p !== 12) fail();
        info.width = 1 + b[p + 12] + (b[p + 13] << 8) + (b[p + 14] << 16);
        info.height = 1 + b[p + 15] + (b[p + 16] << 8) + (b[p + 17] << 16);
        info.animated = !!(b[p + 8] & 2);
      }
      if (kind === "VP8 ") {
        if (n < 10 || ascii(b, p + 11, 3) !== "\x9d\x01\x2a") fail();
        if (!info.width) {
          info.width = view.getUint16(p + 14, true) & 16383;
          info.height = view.getUint16(p + 16, true) & 16383;
        }
        hasImage = true;
      }
      if (kind === "VP8L") {
        if (n < 5 || b[p + 8] !== 0x2f) fail();
        if (!info.width) {
          const bits = view.getUint32(p + 9, true);
          info.width = (bits & 16383) + 1;
          info.height = ((bits >>> 14) & 16383) + 1;
        }
        hasImage = true;
      }
      if (kind === "ANIM" || kind === "ANMF") info.animated = true;
      if (kind === "ANMF") hasImage = true;
      const category =
        kind === "EXIF"
          ? "EXIF"
          : kind === "XMP "
            ? "XMP"
            : kind === "C2PA"
              ? "C2PA"
              : undefined;
      if (
        !category &&
        !["VP8X", "VP8 ", "VP8L", "ALPH", "ANIM", "ANMF", "ICCP"].includes(kind)
      ) {
        info.unknown++;
        if (!info.unknownKinds.includes(kind)) info.unknownKinds.push(kind);
      }
      add({
        start: p,
        end,
        data: p + 8,
        kind,
        category,
        profile: kind === "ICCP",
      });
      p = end;
    }
    if (!hasImage) fail();
  } else {
    let p = 2,
      ended = false,
      scan = false;
    while (p < b.length) {
      const start = p;
      if (b[p++] !== 255) fail();
      while (b[p] === 255) p++;
      const code = b[p++];
      if (code === 0xd9) {
        add({ start, end: p, data: p, kind: "EOI" });
        info.end = p;
        ended = true;
        break;
      }
      if (code === 0xd8 || code === 0 || code === undefined) fail();
      if (code >= 0xd0 && code <= 0xd7) fail();
      if (code === 1) {
        add({ start, end: p, data: p, kind: "TEM" });
        continue;
      }
      if (p + 2 > b.length) fail();
      const n = view.getUint16(p),
        data = p + 2,
        end = p + n;
      if (n < 2 || end > b.length) fail();
      let category: Category | undefined,
        profile = false;
      const label = ascii(b, data, Math.min(n - 2, 40));
      if (code === 0xe1)
        category = label.startsWith("Exif\0\0")
          ? "EXIF"
          : label.includes("adobe.com")
            ? "XMP"
            : "Other";
      else if (
        code === 0xeb &&
        label.startsWith("JP") &&
        new TextDecoder()
          .decode(b.subarray(data, Math.min(end, data + 128)))
          .includes("c2pa")
      )
        category = "C2PA";
      else if (code === 0xed) category = "IPTC";
      else if (code === 0xfe) category = "Comments";
      else if (code === 0xe2) {
        profile = label.startsWith("ICC_PROFILE\0");
        if (!profile) category = "Other";
      } else if (code >= 0xe3 && code <= 0xef && code !== 0xee)
        category = "Other";
      else if (code === 0xe0) {
        if (!label.startsWith("JFIF\0") && !label.startsWith("JFXX\0")) {
          info.unknown++;
          if (!info.unknownKinds.includes("APP0"))
            info.unknownKinds.push("APP0");
        }
        if (label.startsWith("JFXX\0")) category = "Other";
      } else if (code === 0xee && !label.startsWith("Adobe")) {
        info.unknown++;
        if (!info.unknownKinds.includes("APP14"))
          info.unknownKinds.push("APP14");
      }
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(code)
      ) {
        if (n < 8) fail();
        info.height = view.getUint16(data + 1);
        info.width = view.getUint16(data + 3);
      }
      add({
        start,
        end,
        data,
        kind:
          code === 0xe0 && label.startsWith("JFIF\0")
            ? "JFIF"
            : code.toString(16),
        category,
        profile,
      });
      p = end;
      if (code === 0xda) {
        scan = true;
        const scanStart = p;
        while (p < b.length) {
          if (b[p] !== 255) {
            p++;
            continue;
          }
          let q = p + 1;
          while (b[q] === 255) q++;
          if (b[q] === 0 || (b[q] >= 0xd0 && b[q] <= 0xd7)) {
            p = q + 1;
            continue;
          }
          break;
        }
        add({ start: scanStart, end: p, data: scanStart, kind: "entropy" });
      }
    }
    if (!ended || !scan) fail();
  }
  if (!info.width || !info.height)
    fail("Image dimensions are missing or invalid.");
  return info;
}
export function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
export function cleanMetadata(
  b: Uint8Array,
  removeProfiles = false,
): {
  bytes: Uint8Array<ArrayBuffer>;
  before: Inspection;
  after: Inspection;
  removed: number;
  partial: boolean;
} {
  const before = inspect(b);
  if (!before.orientationSafe)
    throw new Error(
      "Cannot safely remove orientation metadata without changing appearance. This file needs orientation normalization first; no output was produced.",
    );
  const parts: Uint8Array[] = [
    b.slice(0, before.format === "jpg" ? 2 : before.format === "png" ? 8 : 12),
  ];
  let removed = 0;
  for (const p of before.parts) {
    if (p.category || (removeProfiles && p.profile)) {
      removed++;
      continue;
    }
    let raw = b.slice(p.start, p.end);
    if (p.kind === "VP8X") raw[8] &= removeProfiles ? ~(8 | 4 | 32) : ~(8 | 4);
    // JFIF thumbnails are descriptive. Keep density/version and remove thumbnail bytes.
    if (p.kind === "JFIF") {
      if (raw.length < 18) fail("Malformed JFIF segment.");
      if (raw[16] || raw[17]) {
        raw = raw.slice(0, 18);
        raw[16] = raw[17] = 0;
        new DataView(raw.buffer).setUint16(2, 16);
        removed++;
      }
    }
    parts.push(raw);
  }
  const bytes = join(parts);
  if (before.format === "webp")
    new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  const after = inspect(bytes);
  if (
    categories.some((k) => after.counts[k] > 0) ||
    (removeProfiles && after.profiles)
  )
    throw new Error("Output verification failed: targeted metadata remains.");
  if (
    before.width !== after.width ||
    before.height !== after.height ||
    before.animated !== after.animated
  )
    throw new Error("Output integrity verification failed.");
  return { bytes, before, after, removed, partial: before.unknown > 0 };
}
