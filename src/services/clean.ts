import { cleanMetadata, mime } from "./metadata";
import { checkLimits, decode } from "./images";
type CleanResult = ReturnType<typeof cleanMetadata>;
export async function clean(
  file: File,
  removeProfiles: boolean,
  signal: AbortSignal,
): Promise<{ blob: Blob; result: CleanResult }> {
  if (signal.aborted) throw new Error("Cancelled.");
  const buffer = await file.arrayBuffer();
  const result = await new Promise<CleanResult>((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/metadata.worker.ts", import.meta.url),
      { type: "module" },
    );
    const abort = () => {
      worker.terminate();
      reject(new Error("Cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    const finish = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    worker.onmessage = (
      e: MessageEvent<{ result?: CleanResult; error?: string }>,
    ) => {
      finish();
      if (e.data.result) resolve(e.data.result);
      else reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error(
          "Metadata worker failed. Try a smaller file or a current browser.",
        ),
      );
    };
    worker.postMessage({ buffer, removeProfiles }, [buffer]);
    if (signal.aborted) {
      finish();
      reject(new Error("Cancelled."));
    }
  });
  const blob = new Blob([result.bytes], { type: mime[result.before.format] });
  const bitmap = await decode(blob);
  try {
    checkLimits(bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
  if (signal.aborted) throw new Error("Cancelled.");
  return { blob, result };
}
