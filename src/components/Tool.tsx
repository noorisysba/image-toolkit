import { useEffect, useRef, useState } from "react";
import {
  Upload,
  Plus,
  Trash2,
  X,
  ArrowRight,
  Download,
  FolderDown,
  LoaderCircle,
  Info,
  CheckCircle2,
  ShieldCheck,
  ArrowRightLeft,
  FileImage,
  OctagonAlert,
} from "lucide-react";
import { categories, type Format, type Inspection } from "../services/metadata";
import { convert, LIMITS, validate, thumbnail } from "../services/images";
import { clean } from "../services/clean";
import {
  download,
  outputName,
  size,
  uniqueName,
  zipFiles,
} from "../services/downloads";
type Status = "Waiting" | "Processing" | "Completed" | "Failed" | "Cancelled";
type Item = {
  id: string;
  file: File;
  url: string;
  info: Inspection;
  width: number;
  height: number;
  status: Status;
  error?: string;
  output?: {
    blob: Blob;
    url: string;
    name: string;
    note: string;
    partial: boolean;
  };
};
export function Tool({ mode }: { mode: "converter" | "metadata" }) {
  const metadata = mode === "metadata",
    [items, setItems] = useState<Item[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [format, setFormat] = useState<Format>("webp"),
    [quality, setQuality] = useState(90),
    [background, setBackground] = useState("#ffffff"),
    [profiles, setProfiles] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [drag, setDrag] = useState(false),
    [zipProgress, setZipProgress] = useState<number | null>(null),
    [batch, setBatch] = useState<{
      done: number;
      total: number;
      failed: number;
      cancelled: boolean;
    } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    urls = useRef(new Set<string>()),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true),
    adding = useRef(false),
    running = useRef(false),
    current = useRef(items);
  current.current = items;
  const makeURL = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  };
  const release = (url: string) => {
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, []);
  async function add(files: File[]) {
    if (adding.current || running.current) return;
    adding.current = true;
    setLoading(true);
    setBatch(null);
    const messages: string[] = [];
    const slots = LIMITS.files - current.current.length;
    if (files.length > slots)
      messages.push(
        `A batch can contain up to ${LIMITS.files} files. Only the first ${Math.max(0, slots)} additional files were checked.`,
      );
    for (const file of files.slice(0, Math.max(0, slots))) {
      try {
        const { preview, ...result } = await validate(file, true);
        if (!alive.current) return;
        const item: Item = {
          id: crypto.randomUUID(),
          file,
          url: makeURL(preview!),
          ...result,
          status: "Waiting",
        };
        setItems((old) => [...old, item]);
      } catch (e) {
        messages.push(
          `${file.name}: ${e instanceof Error ? e.message : "Could not read this image."}`,
        );
      }
    }
    if (alive.current) {
      setErrors(messages);
      setLoading(false);
    }
    adding.current = false;
  }
  function remove(item: Item) {
    release(item.url);
    if (item.output) release(item.output.url);
    setItems((old) => old.filter((x) => x.id !== item.id));
    setBatch(null);
  }
  function clear() {
    for (const item of items) {
      release(item.url);
      if (item.output) release(item.output.url);
    }
    setItems([]);
    setErrors([]);
    setBatch(null);
  }
  async function run() {
    if (running.current || adding.current || !items.length) return;
    running.current = true;
    setBusy(true);
    setErrors([]);
    const abort = new AbortController();
    controller.current = abort;
    const queue = [...items],
      used = new Set<string>();
    let done = 0,
      failed = 0;
    setBatch({ done, total: queue.length, failed, cancelled: false });
    for (const item of queue) if (item.output) release(item.output.url);
    setItems((old) =>
      old.map((item) => ({
        ...item,
        status: "Waiting",
        output: undefined,
        error: undefined,
      })),
    );
    // One decoded image at a time bounds memory. Cancellation stops the worker and pending files.
    for (const item of queue) {
      if (abort.signal.aborted) break;
      setItems((old) =>
        old.map((x) =>
          x.id === item.id
            ? {
                ...x,
                status: "Processing",
                output: undefined,
                error: undefined,
              }
            : x,
        ),
      );
      try {
        let blob: Blob,
          note = "",
          partial = false;
        if (metadata) {
          const result = await clean(item.file, profiles, abort.signal);
          blob = result.blob;
          partial = result.result.partial;
          const removed = categories
            .filter((k) => result.result.before.counts[k] > 0)
            .join(", ");
          note = result.result.removed
            ? `Metadata Removed · Verified. ${removed ? `Removed: ${removed}. ` : ""}${profiles ? "Embedded profiles removed." : "Colour profiles retained when present."}`
            : "No Recognised Metadata Found · Verified.";
          if (partial)
            note +=
              " Partially Removed: unrecognised structures were retained; their contents cannot be verified.";
        } else {
          blob = await convert(item.file, format, quality, background);
          note = "Completed · Format and dimensions verified.";
        }
        if (abort.signal.aborted) throw new Error("Cancelled.");
        const ext = metadata
          ? item.info.format === "jpg" && /\.jpeg$/i.test(item.file.name)
            ? "jpeg"
            : item.info.format
          : format;
        const preview = await thumbnail(blob);
        if (abort.signal.aborted) throw new Error("Cancelled.");
        const output = {
          blob,
          url: makeURL(preview),
          name: uniqueName(outputName(item.file.name, ext, metadata), used),
          note,
          partial,
        };
        setItems((old) =>
          old.map((x) =>
            x.id === item.id ? { ...x, status: "Completed", output } : x,
          ),
        );
      } catch (e) {
        if (!abort.signal.aborted) failed++;
        setItems((old) =>
          old.map((x) =>
            x.id === item.id
              ? {
                  ...x,
                  status: abort.signal.aborted ? "Cancelled" : "Failed",
                  error:
                    e instanceof Error
                      ? e.message
                      : "Processing failed. Try a smaller image.",
                }
              : x,
          ),
        );
      }
      if (abort.signal.aborted) break;
      done++;
      setBatch({ done, total: queue.length, failed, cancelled: false });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (abort.signal.aborted) {
      setItems((old) =>
        old.map((x) =>
          x.status === "Waiting" || x.status === "Processing"
            ? { ...x, status: "Cancelled" }
            : x,
        ),
      );
      setBatch({ done, total: queue.length, failed, cancelled: true });
    }
    controller.current = null;
    running.current = false;
    setBusy(false);
  }
  const completed = items.filter((x) => x.output),
    locked = busy || loading || zipProgress !== null;
  async function zip() {
    setZipProgress(0);
    try {
      const blob = await zipFiles(
        completed.map((x) => ({ name: x.output!.name, blob: x.output!.blob })),
        setZipProgress,
      );
      download(
        blob,
        metadata ? "image-toolkit-cleaned.zip" : "image-toolkit-converted.zip",
      );
    } catch {
      setErrors([
        "Could not prepare the ZIP. Download files individually or try a smaller batch.",
      ]);
    } finally {
      setZipProgress(null);
    }
  }
  return (
    <div className="tool-grid">
      <section className="card files-card">
        <div className="card-heading">
          <div className="section-title">
            <span className="step">1</span>
            <h2>Your images</h2>
            <span className="count">{items.length}</span>
          </div>
          <span className="local-label">
            <ShieldCheck size={14} /> Local only
          </span>
        </div>
        <div className="files-body">
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            multiple
            aria-label={
              metadata
                ? "Upload images to remove metadata"
                : "Upload images to convert"
            }
            onChange={(e) => {
              void add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
            disabled={locked}
          />
          <button
            className={`dropzone ${drag ? "dragging" : ""} ${items.length ? "compact" : ""}`}
            disabled={locked}
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              if (!locked) void add(Array.from(e.dataTransfer.files));
            }}
          >
            <span className="upload-icon">
              {loading ? (
                <LoaderCircle className="spin" size={27} />
              ) : (
                <Upload size={27} />
              )}
            </span>
            <strong>
              {loading
                ? "Checking your images…"
                : items.length
                  ? "Add more images"
                  : "Drop your images here, or click to browse"}
            </strong>
            <span>Supports PNG, JPG and WebP</span>
            {!items.length && (
              <span className="browse-label">
                <Plus size={15} />
                Choose images
              </span>
            )}
          </button>
          <div className="limits">
            <span>Up to 50 images · 40 MB per file</span>
            <span>32 megapixels per image</span>
          </div>
          {errors.length > 0 && (
            <div role="alert" className="error-box">
              <div className="error-title">
                <OctagonAlert size={17} />
                Some files need attention
                <button
                  aria-label="Dismiss errors"
                  onClick={() => setErrors([])}
                >
                  <X size={15} />
                </button>
              </div>
              {errors.map((error, i) => (
                <p key={i}>{error}</p>
              ))}
            </div>
          )}
          {items.length > 0 ? (
            <>
              <div className="list-heading">
                <strong>
                  {items.length} image{items.length !== 1 ? "s" : ""} added
                </strong>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={clear}
                >
                  <Trash2 size={14} />
                  Clear all
                </button>
              </div>
              <ul className="file-list">
                {items.map((item) => (
                  <li key={item.id} className="file-item">
                    <div className="file-top">
                      <img className="thumbnail" src={item.url} alt="" />
                      <div className="file-details">
                        <strong title={item.file.name}>{item.file.name}</strong>
                        <span>
                          {item.info.format.toUpperCase()} <i />{" "}
                          {size(item.file.size)} <i /> {item.width} ×{" "}
                          {item.height}
                        </span>
                        <span className={`status ${item.status.toLowerCase()}`}>
                          {item.status === "Processing" && (
                            <LoaderCircle size={12} className="spin" />
                          )}
                          {item.status === "Completed" && (
                            <CheckCircle2 size={12} />
                          )}{" "}
                          {item.status}
                          {item.info.animated ? " · Animated" : ""}
                        </span>
                      </div>
                      <button
                        className="icon-button"
                        disabled={locked}
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => remove(item)}
                      >
                        <X size={17} />
                      </button>
                    </div>
                    {metadata && (
                      <div
                        className="metadata-summary"
                        aria-label={`Metadata summary for ${item.file.name}`}
                      >
                        {categories.map((key) => (
                          <span
                            className={item.info.counts[key] ? "found" : ""}
                            key={key}
                          >
                            {key === "Other" ? "Other recognised" : key}:{" "}
                            {item.info.counts[key]
                              ? `Found (${item.info.counts[key]})`
                              : "Not found"}
                          </span>
                        ))}
                        {item.info.profiles > 0 && (
                          <span>
                            Colour profiles: {item.info.profiles} retained by
                            default
                          </span>
                        )}
                        {item.info.unknown > 0 && (
                          <span>
                            Unrecognised structures: {item.info.unknown}; cannot
                            verify their contents
                          </span>
                        )}
                      </div>
                    )}
                    {item.error && (
                      <p className="file-error" role="alert">
                        {item.error}
                      </p>
                    )}
                    {item.output && (
                      <div className="output">
                        <div className="output-top">
                          <img
                            className="result-thumbnail"
                            src={item.output.url}
                            alt="Output preview"
                          />
                          <div>
                            <strong>{item.output.name}</strong>
                            <span>
                              {size(item.file.size)} <ArrowRight size={12} />{" "}
                              {size(item.output.blob.size)}{" "}
                              <em
                                className={
                                  item.output.blob.size <= item.file.size
                                    ? "reduction"
                                    : ""
                                }
                              >
                                {Math.abs(
                                  (1 - item.output.blob.size / item.file.size) *
                                    100,
                                ).toFixed(1)}
                                %{" "}
                                {item.output.blob.size <= item.file.size
                                  ? "smaller"
                                  : "larger"}
                              </em>
                            </span>
                          </div>
                          <button
                            className="download-button"
                            onClick={() =>
                              download(item.output!.blob, item.output!.name)
                            }
                            aria-label={`Download ${item.output.name}`}
                          >
                            <Download size={16} />
                            <span>Download</span>
                          </button>
                        </div>
                        <p className={item.output.partial ? "partial" : ""}>
                          {item.output.note}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="empty-hint">
              <FileImage size={16} />
              <span>Your images will appear here. Ready when you are.</span>
            </div>
          )}
          {batch && (
            <div className="progress-box" aria-live="polite">
              <div>
                <strong>
                  {busy
                    ? "Processing your images…"
                    : batch.cancelled
                      ? "Processing cancelled"
                      : batch.failed
                        ? "Batch finished with errors"
                        : "Batch complete"}
                </strong>
                <span>{Math.round((batch.done / batch.total) * 100)}%</span>
              </div>
              <progress max={batch.total} value={batch.done} />
              <small>
                {batch.total} total · {batch.done - batch.failed} processed ·{" "}
                {batch.total - batch.done} remaining · {batch.failed} failed
              </small>
            </div>
          )}
          {completed.length > 1 && (
            <button
              className="zip-button"
              disabled={locked}
              onClick={() => void zip()}
            >
              <FolderDown size={18} />
              {zipProgress !== null
                ? `Preparing ZIP… ${zipProgress}%`
                : "Download All as ZIP"}
              <span>{completed.length} files</span>
            </button>
          )}
        </div>
      </section>
      <aside>
        <section className="card settings-card">
          <div className="card-heading">
            <div className="section-title">
              <span className="step">2</span>
              <h2>{metadata ? "Cleaning options" : "Conversion settings"}</h2>
            </div>
          </div>
          <div className="settings-body">
            {metadata ? (
              <>
                <div className="clean-default">
                  <ShieldCheck size={23} />
                  <strong>Privacy essentials</strong>
                  <p>
                    Remove recognised EXIF, GPS, XMP, IPTC, comments and
                    descriptive text.
                  </p>
                </div>
                <div className="setting-note">
                  <CheckCircle2 size={15} />
                  <span>
                    Original format and compressed image data preserved
                  </span>
                </div>
                <details>
                  <summary>Advanced settings</summary>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={profiles}
                      disabled={locked}
                      onChange={(e) => setProfiles(e.target.checked)}
                    />
                    Remove embedded colour profiles
                  </label>
                  <p className="warning-text">
                    Removing profiles can change colours. Profiles are retained
                    by default and may contain descriptive information.
                  </p>
                </details>
              </>
            ) : (
              <>
                <label className="field-label" id={`${mode}-format`}>
                  Convert to
                </label>
                <div
                  className="format-options"
                  role="group"
                  aria-labelledby={`${mode}-format`}
                >
                  {(["png", "jpg", "webp"] as Format[]).map((value) => (
                    <button
                      key={value}
                      aria-pressed={format === value}
                      disabled={locked}
                      className={format === value ? "selected" : ""}
                      onClick={() => setFormat(value)}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="format-help">
                  {format === "webp"
                    ? "Smaller files, with transparency support."
                    : format === "png"
                      ? "Lossless encoding, with transparency support."
                      : "Widely compatible, with a solid background."}
                </p>
                <div className="quality-label">
                  <label htmlFor="quality">Image quality</label>
                  <strong>
                    {format === "png" ? "Lossless" : `${quality}%`}
                  </strong>
                </div>
                <input
                  id="quality"
                  type="range"
                  min="1"
                  max="100"
                  value={quality}
                  disabled={locked || format === "png"}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
                <div className="range-labels">
                  <span>Smaller file</span>
                  <span>Higher quality</span>
                </div>
                {format === "jpg" && (
                  <label className="background-field">
                    Transparency background
                    <input
                      type="color"
                      aria-label="Transparency background"
                      disabled={locked}
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                    />
                  </label>
                )}
                <div className="setting-note">
                  <CheckCircle2 size={15} />
                  <span>Original dimensions preserved</span>
                </div>
              </>
            )}
            <button
              className="primary-button"
              disabled={locked || !items.length}
              onClick={() => void run()}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : metadata ? (
                <ShieldCheck size={17} />
              ) : (
                <ArrowRightLeft size={17} />
              )}{" "}
              {busy
                ? "Processing…"
                : metadata
                  ? "Remove Metadata"
                  : items.length === 1
                    ? "Convert Image"
                    : "Convert Images"}
              {!busy && <ArrowRight size={16} />}
            </button>
            {busy && (
              <button
                className="cancel-button"
                onClick={() => controller.current?.abort()}
              >
                Cancel processing
              </button>
            )}
            <p className="settings-caption">
              {items.length
                ? `${items.length} image${items.length !== 1 ? "s" : ""} ready to ${metadata ? "clean" : "convert"}`
                : "Add images to get started"}
            </p>
          </div>
        </section>
        <div className="tip">
          <Info size={17} />
          <p>
            {metadata
              ? "Cleaning is verified for recognised metadata. Essential rendering information is retained. Visible details in image pixels and copies stored elsewhere are unaffected."
              : "Conversion re-encodes your image and may change or discard metadata. For verified metadata removal, use the dedicated Metadata Remover."}
          </p>
        </div>
        {metadata && (
          <div className="tip">
            <Info size={17} />
            <p>
              Files with non-standard orientation are rejected if cleaning could
              change their appearance. Animation is preserved. Unknown
              structures are retained and flagged as partially processed.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
