import { cleanMetadata } from "../services/metadata";
self.onmessage = (
  event: MessageEvent<{ buffer: ArrayBuffer; removeProfiles: boolean }>,
) => {
  try {
    const result = cleanMetadata(
      new Uint8Array(event.data.buffer),
      event.data.removeProfiles,
    );
    self.postMessage({ result }, { transfer: [result.bytes.buffer] });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Metadata processing failed.",
    });
  }
};
