import JSZip from "jszip";
export const MAX_ZIP_BYTES = 128 * 1024 * 1024;
export function safeName(name: string): string {
  return (
    name
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
      .replace(/^\.+/, "")
      .replace(/[. ]+$/, "")
      .slice(0, 160) || "image"
  );
}
export function uniqueName(name: string, used: Set<string>): string {
  name = safeName(name);
  const dot = name.lastIndexOf("."),
    base = dot > 0 ? name.slice(0, dot) : name,
    ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name,
    n = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base}_${n++}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}
export function outputName(name: string, ext: string, clean = false): string {
  return safeName(
    `${name.replace(/\.[^.]*$/, "")}${clean ? "_clean" : ""}.${ext}`,
  );
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export async function zipFiles(
  files: { name: string; blob: Blob }[],
  progress: (n: number) => void,
): Promise<Blob> {
  if (files.reduce((total, file) => total + file.blob.size, 0) > MAX_ZIP_BYTES)
    throw new Error(
      "These results exceed the 128 MB ZIP safety limit. Download images individually or use a smaller batch.",
    );
  const zip = new JSZip(),
    used = new Set<string>();
  for (const file of files)
    zip.file(uniqueName(file.name, used), await file.blob.arrayBuffer());
  return zip.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
    progress(Math.round(m.percent)),
  );
}
export function size(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
