import { detectFormat, inspect, mime, type Format } from "./metadata";
export const LIMITS = {
  files: 50,
  bytes: 40 * 1024 * 1024,
  pixels: 32_000_000,
  dimension: 16384,
};
export function checkLimits(width: number, height: number) {
  if (
    width * height > LIMITS.pixels ||
    width > LIMITS.dimension ||
    height > LIMITS.dimension
  )
    throw new Error(
      "Image exceeds the safety limit: 32 megapixels or 16,384 pixels per side.",
    );
}
export async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      "Image decoding failed. The file may be corrupted or unsupported by this browser.",
    );
  }
}
async function bitmapThumbnail(
  bitmap: ImageBitmap,
  type: string,
): Promise<Blob> {
  const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create an image preview.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not create an image preview.")),
        type,
        0.9,
      ),
    );
  } finally {
    canvas.width = canvas.height = 0;
  }
}
export async function thumbnail(blob: Blob): Promise<Blob> {
  const bitmap = await decode(blob);
  try {
    return await bitmapThumbnail(bitmap, blob.type);
  } finally {
    bitmap.close();
  }
}
export async function validate(file: File, withPreview = false) {
  if (!file.size) throw new Error("This file is empty.");
  if (file.size > LIMITS.bytes)
    throw new Error("File exceeds the 40 MB limit.");
  const bytes = new Uint8Array(await file.arrayBuffer()),
    info = inspect(bytes);
  checkLimits(info.width, info.height);
  const bitmap = await decode(new Blob([bytes], { type: mime[info.format] }));
  try {
    checkLimits(bitmap.width, bitmap.height);
    const preview = withPreview
      ? await bitmapThumbnail(bitmap, mime[info.format])
      : undefined;
    return { info, width: bitmap.width, height: bitmap.height, preview };
  } finally {
    bitmap.close();
  }
}
export async function convert(
  file: File,
  format: Format,
  quality: number,
  background: string,
): Promise<Blob> {
  const { info } = await validate(file);
  if (info.animated)
    throw new Error(
      "Animated images cannot be converted while preserving all frames. Use the metadata remover to clean animation without converting it.",
    );
  const bitmap = await decode(
    new Blob([await file.arrayBuffer()], { type: mime[info.format] }),
  );
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot create an image canvas.");
    if (format === "jpg") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("Image encoding failed. Try a smaller file.")),
        mime[format],
        quality / 100,
      ),
    );
    if (
      blob.type !== mime[format] ||
      detectFormat(new Uint8Array(await blob.arrayBuffer())) !== format
    )
      throw new Error(
        "Your browser does not support the selected output format.",
      );
    const result = await decode(blob);
    try {
      if (result.width !== bitmap.width || result.height !== bitmap.height)
        throw new Error("Output dimensions did not match the original.");
    } finally {
      result.close();
    }
    return blob;
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}
