# Image Toolkit regression audit

Date: 22 October 2026. Local host: Windows x64.

The final local audit used a **static production build**, not the development server. Results are automated browser checks and visual inspection of captured layouts. They are not represented as manual native-browser or physical-device sign-off.

## Implemented changes

- Three vertical steps: upload, settings/process, downloads. Results follow settings instead of appearing inside the upload list. Processing moves focus to the results heading.
- The upload target has a blue border, light blue background and solid blue browse button.
- The supplied Image Toolkit logo is used unchanged. Its source and public asset have the same SHA-256. CSS fits the artwork into the header without modifying the image.
- Long upload and result lists scroll inside bounded areas, so a full batch does not bury the controls under fifty expanded cards.
- Full-size bitmaps are closed after drawing; canvas backing stores are released before decoding the output for verification. Thumbnails remain limited to 96 pixels.
- Batch results are published as complete snapshots. The final summary is reconciled with actual output records, preventing stale processing rows from being presented as successful completed files.
- Aggregate safeguards: 256 MiB input per tool queue, 256 MiB retained results per queue, and 128 MiB input to ZIP preparation. The original 50-file, 40 MiB/file and 32-megapixel limits remain. These caps do not guarantee that every supported image fits every device's memory.
- Browser tests now build and serve production assets by default, avoiding hot reloads during lengthy batch tests.

## Actual local test results

28 Vitest unit tests passed. Strict TypeScript checking and the production build passed. Production dependency audit: no known vulnerabilities reported by pnpm.

The final local browser invocation scheduled 95 checks: **93 passed, 2 intentionally skipped, 0 failed, 0 flaky**.

| Configuration           | Actual engine                     | Passed | Skipped |
| ----------------------- | --------------------------------- | -----: | ------: |
| Chromium desktop        | Chromium 156.0.8078.4             |     19 |       0 |
| Installed Google Chrome | Chrome 155.0.8059.85              |     19 |       0 |
| WebKit desktop          | Playwright WebKit 27.2 on Windows |     18 |       1 |
| Pixel 7 profile         | Chromium phone emulation          |     19 |       0 |
| iPhone 13 profile       | WebKit phone emulation            |     18 |       1 |

The two skips are Chromium-specific CDP resource/heap instrumentation in WebKit configurations. Functional image processing, orientation and maximum-count batch checks executed in every listed configuration. WebKit is not an installed Safari browser; phone profiles are not physical phones.

An additional responsive-layout check found no horizontal overflow at widths 320, 360, 390, 720, 740, 768, 820, 1024 and 1440 pixels in Chromium. The permanent layout audit also checks representative widths across its selected engines.

## Orientation and image integrity

- All eight EXIF orientation values were tested with an asymmetric JPEG fixture, including mirrored and transposed orientations.
- JPEG-to-PNG conversion was checked against an explicit, independent source-coordinate mapping. The output pixel arrangement and displayed dimensions matched in every case.
- Metadata cleaning rejects non-identity orientation when removal would change displayed appearance. The tests verified that these files produce an explanation and no cleaned download.
- All six cross-format conversions were checked for real signatures, MIME types, dimensions and extensions. Same-format PNG alpha, WebP alpha and JPEG white/custom backgrounds were checked with actual browser encoders.
- Animated WebP conversion is explicitly rejected. Metadata removal preserves its animation container and frame bytes.
- Recognised EXIF/GPS, XMP, IPTC, comments, PNG text and C2PA metadata are reinspected after removal. Unit tests compare exact decoded pixels and compressed payload bytes for lossless cleaning, including colour-profile policies.
- Unknown structures are named and marked for review rather than presented as verified full removal.

## Large-batch audit

Every listed browser configuration executed the maximum-count test:

1. Select 51 files and confirm that only 50 enter the queue with a readable limit message.
2. Check that uploaded file identities are unique and the list remains bounded in height.
3. Process all 50 files and require 50 actual download results.
4. Download the ZIP, require 50 unique entries, reinspect every entry for C2PA removal, and compare it byte for byte with the known clean fixture.

The 50-file correctness fixture is deliberately tiny, making it suitable for repeatable cross-browser regression tests. It is not a claim that fifty maximum-size photos were stress-tested.

A development-server run exposed inconsistent completion/output presentation. Full batch snapshots and final result reconciliation were introduced. A separate retest was invalidated by a development-server reload; the final audit therefore uses production assets. The final static-build 50-file checks passed in all five configurations.

## Browser memory/resource observations

Each Chromium-based configuration processed **three batches of eight 1024 × 768 noise images**. Each batch contained 21,560,160 bytes (about 20.56 MiB) of compressed inputs. The queue was cleared after each cycle.

Observed in all three configurations:

- Peak application-created live `ImageBitmap` count: **1**.
- Live application-created bitmaps after processing: **0**.
- Retained preview URLs with eight inputs and eight outputs: **16**.
- Preview URLs after clearing: **0**.
- Canvas backing stores left nonzero after processing: **0**.
- All thumbnail dimensions stayed bounded, and downloaded images retained full dimensions.

| Configuration            | Post-clear JS heap, cycle 1 | Post-clear JS heap, cycle 3 | Preview bytes before clear |
| ------------------------ | --------------------------: | --------------------------: | -------------------------: |
| Chromium desktop         |                   4,459,960 |                   4,621,572 |                    379,504 |
| Installed Chrome         |                   4,541,780 |                   4,712,744 |                    347,888 |
| Chromium phone emulation |                   4,491,168 |                   4,655,188 |                    379,504 |

Heap samples were taken after requesting garbage collection through CDP. Test instrumentation itself retains small tracking objects. These measurements verify the tested application-owned resource lifetimes; they **exclude Blob backing stores, GPU memory, browser decoder caches, other browser processes and total RSS**. They are not proof of zero memory growth under all workloads. Worst-case 32-megapixel images, fifty 40 MiB images, prolonged physical-phone use and OS memory-pressure termination were not tested.

ZIP preparation can make additional binary copies, which is why its input cap is lower than the queue cap. An automated unit test confirms that an oversized ZIP is rejected before any image buffer is read. Larger results remain individually downloadable. Download-only object URLs use a short delayed cleanup so the browser can finish starting the download.

## Firefox and CI coverage

The local Playwright Firefox 157 package failed to launch on this Windows host with Win32 error 14001, reporting an unresolved `mozglue` side-by-side assembly. This is a browser-runtime launch failure; no local Firefox application test pass is inferred from it.

The official Mozilla Firefox 158.0.1 release was obtained in an isolated, ignored test directory and its `--version` command succeeded. A successful version command is **not** a functional or manual-browser test.

The deployment workflow now uses Microsoft's version-matched Playwright Linux container as user 1001 and runs the full production-build Chromium, Firefox and WebKit suites before publishing. The non-root user matches the runner's home-directory ownership, which Firefox requires. The Linux Firefox outcome is recorded in the [associated GitHub Actions run](https://github.com/noorisysba/image-toolkit/actions/workflows/deploy.yml), separately from the 93 local passes above. Each CI run also retains its JSON audit results and failure traces for seven days. Keeping this outcome in Actions avoids treating a Windows runtime problem as a skipped product test.

The cancellation test deliberately delays the callback to the real native canvas encoder by one second after uploads finish. It still encodes actual images, while ensuring there is pending work when the cancel button is pressed; otherwise tiny fixtures can finish before a fast CI browser completes the click.

## Manual and physical-device testing limitations

**Manual sign-off remains incomplete.** Native manual checks were attempted but the computer-control runtime stopped because it could not determine the current Chrome URL confidently enough to enforce its policy. The initial background Firefox launch was also rejected by automatic review with the generic reason “blocked by policy.” Permission to open the downloaded Firefox was subsequently provided, but it did not restore the stopped manual-control session. No manual Chrome or Firefox success is claimed.

No Mac/Safari session or physical phone test session was available. WebKit and phone emulation do not validate Safari's full application, iOS download UI, hardware codecs, actual touch hardware, thermal behaviour or low-memory process eviction.

Before claiming complete manual/device sign-off, use real Chrome, Firefox, Safari and at least one real phone to verify:

1. Browse/drop, clear, navigation and downloading in the new three-step flow.
2. A real rotated or mirrored camera photo, comparing displayed orientation before and after conversion.
3. A photo with known GPS/EXIF plus a C2PA PNG, verifying the downloaded files with an independent metadata inspector.
4. A realistic batch of photos, ZIP downloads and cancellation.
5. Repeated upload/process/download/clear cycles while observing the browser or OS memory tools and responsiveness.

## Reproduce the automated audit

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm exec playwright install chromium firefox webkit
pnpm test:audit --project=chromium --project=chrome --project=webkit --project=mobile-chromium --project=mobile-webkit
```

The `chrome` project requires an installed Google Chrome. Use `--project=firefox` where its test runtime launches successfully; the pinned Linux CI supplies that environment. `pnpm test:e2e` runs Chromium by default. Both scripts build a fresh static production bundle unless `TEST_URL` points to an existing deployment.
