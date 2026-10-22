# Image Toolkit

Two free, private image utilities that run entirely in your browser.

**Website:** https://noorisysba.github.io/image-toolkit/

- [Image Converter](https://noorisysba.github.io/image-toolkit/#/converter): genuinely encode PNG, JPG and WebP, adjust lossy quality, preserve dimensions and alpha, choose a JPEG transparency background, normalise EXIF orientation, and download individual results or a batch ZIP.
- [Metadata Remover](https://noorisysba.github.io/image-toolkit/#/metadata-remover): inspect and remove recognised EXIF/GPS, XMP, IPTC, comments, textual metadata and embedded thumbnails. Lossless container editing preserves image format and compressed pixel data. Output is reinspected and decoded before download becomes available. Animation and colour profiles are retained by default.

Each tool has a separate in-memory queue that survives navigation between tools. Supports adding files, removing files, clearing, failure isolation, cancellation, file-level progress, and collision-safe filenames. Mobile and keyboard accessible. No backend, account, analytics, persistence, external fonts, image uploads or processing network requests.

## Use the website

1. Open either tool and choose images or drag files into the upload area.
2. For conversion, choose PNG, JPG or WebP and set quality (JPG/WebP only).
3. Click **Convert Images** or **Remove Metadata**.
4. Review each result and download individually, or use **Download All as ZIP** after multiple successes.

You can change settings and process again. Doing so replaces previous results. Cancel stops the active metadata worker and pending files; an in-progress browser canvas encode finishes before its result is discarded. Completed files remain downloadable. Closing or refreshing the page releases the queue.

## Run locally

Install [Node.js 24 LTS](https://nodejs.org/) (includes npm) and [Git](https://git-scm.com/). In a terminal:

```sh
git clone https://github.com/noorisysba/image-toolkit.git
cd image-toolkit
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev
```

Open the local address printed in the terminal, normally `http://127.0.0.1:5173/image-toolkit/`. Stop with Ctrl+C.

## Tests and production build

```sh
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
pnpm preview
```

On Linux, use `pnpm exec playwright install --with-deps chromium` for browser system packages. `pnpm build` runs strict TypeScript checks before generating `dist/`. Preview serves the production files at `http://127.0.0.1:4173/image-toolkit/`.

Unit tests generate actual tiny RGBA images with Sharp and add known, structured metadata fixtures. They test privacy categories, output decoding and exact pixels, compressed payload equality, orientation refusal, animation, colour-profile policies, malformed containers, PNG CRCs, trailing data, safe naming and real ZIP contents. Playwright exercises all six cross-format conversions, MIME/signatures/dimensions, alpha and JPEG background, EXIF orientation conversion, animated WebP refusal and cleaning, metadata workers, batch ZIP downloads, partial failures, queue independence, cancellation, mobile layout and absence of processing HTTP requests. Tests use synthetic images with no personal data. Sharp is development-only; no Sharp or Node server is shipped to the browser.

## Publish to GitHub Pages

This repository uses the official GitHub Pages actions. Every push to `main` runs unit tests, Chromium browser tests and the production build before deploying.

For a new copy in your own account:

1. Sign in to GitHub, click **+ → New repository**, name it `image-toolkit`, choose **Public**, and create it without initial files.
2. In the local project terminal, run the commands below, replacing `YOUR_USERNAME`:

   ```sh
   git init
   git branch -M main
   git add .
   git commit -m "Build Image Toolkit"
   git remote add origin https://github.com/YOUR_USERNAME/image-toolkit.git
   git push -u origin main
   ```

   If `origin` already exists, use `git remote set-url origin https://github.com/YOUR_USERNAME/image-toolkit.git` instead of adding it. Sign in if Git requests it.

3. In the GitHub repository, open **Settings → Pages → Build and deployment**, and select **GitHub Actions** as the source.
4. Open **Actions → Test and deploy Image Toolkit**. If the first run occurred before Pages was enabled, choose **Run workflow** and select `main`.
5. Wait for the build and deploy jobs to turn green. The site is `https://YOUR_USERNAME.github.io/image-toolkit/`. Either hash route can be bookmarked directly.

If changing the repository name, change `base` in `vite.config.ts` to `/<new-name>/` and update the README and the source link in `src/App.tsx`. HashRouter avoids GitHub Pages deep-link 404s. All assets use the Vite base path.

## Update the deployed application

Edit the files, run the tests and build above, then:

```sh
git add .
git commit -m "Describe your update"
git push origin main
```

GitHub Actions automatically tests and redeploys. Review the Actions logs if deployment fails. No paid service or hosting secret is required. The optional `scripts/github-api.mjs` is a local repository administration helper that reads existing OS Git credentials in memory; it is never bundled into the website and never stores credentials.

## Technical design

React 19, strict TypeScript, Vite, Tailwind CSS 4, Lucide React, React Router HashRouter and JSZip. Native image decoding and canvas encoding implement conversion. A dedicated Web Worker handles metadata removal. Controlled concurrency processes one image at a time and closes ImageBitmaps, resets canvases and revokes unused Blob URLs. Previews are separate thumbnails bounded to 96 pixels; downloads retain full original dimensions. Filenames are sanitised and ZIP names are made unique case-insensitively.

`src/components/Tool.tsx` provides shared UI with independent component state. `src/services/images.ts` handles decoding/conversion/limits, `metadata.ts` handles binary parsing and container editing, `clean.ts` manages workers and output verification, and `downloads.ts` handles naming and ZIPs.

## Privacy policy and limitations

- Images stay in memory on your device. No uploads, telemetry, cookies, browser storage, remote image APIs or external font requests. GitHub serves the app's static files and may log the page request under its own policies. The app makes no image-processing HTTP requests.
- Defaults: 50 files per tool, 40 MB per file, 32 million pixels, 16,384 pixels per side. Constants live in `src/services/images.ts`. Device memory and browser codec limits may be lower; errors remain local to a file. An exceptionally large animation can use more memory than a still image.
- Converter rejects animated WebP and APNG because canvas encoding cannot preserve all frames. Metadata cleaning retains animation chunks byte for byte. Conversion may change colours or remove metadata as a consequence of re-encoding; it does not perform the cleaner's verified removal workflow.
- Cleaning refuses non-identity EXIF orientation, malformed EXIF, legacy PNG raw EXIF/IPTC text and recognised non-identity XMP orientation instead of silently changing appearance. Use an editor to normalise orientation first, or convert and then submit the converted file to the cleaner as a separate action.
- Removes recognised descriptive containers: JPEG EXIF/XMP APP1, IPTC APP13, COM, JFXX thumbnails, other descriptive APP segments; PNG `eXIf`, text chunks, `tIME` and `dSIG`; WebP EXIF and XMP. JFIF thumbnails are removed without deleting JFIF rendering data. JPEG compressed scans (including progressive scans) are copied intact. PNG CRCs are validated. WebP RIFF sizes and VP8X feature flags are repaired.
- Essential rendering data (including JFIF density, Adobe rendering transforms, PNG gamma/transparency/palette/animation and ICC profiles) is retained by default. Colour profiles can contain descriptive data: explicitly choose removal if this matters, with a possible colour shift. Removing ICC profiles does not remove essential PNG gamma/sRGB/cICP rendering chunks.
- Unknown ancillary PNG/WebP structures or unrecognised retained JPEG rendering segments are flagged as **Partially Removed**. The app verifies recognised categories only; it cannot promise detection of every proprietary metadata scheme. GPS is reported only as Found/Not found when the EXIF GPS pointer is detected; coordinates are never displayed.
- This is not a forensic sanitiser or malware scanner. It cannot remove information visible in pixels, steganography, or copies held elsewhere. Unsupported or damaged files produce an error rather than an invalid download.
- Tested in Chromium. Current desktop browsers are recommended; specific older/mobile codec capabilities vary. No unexecuted Safari/Firefox test coverage is claimed.

Container references: [PNG specification](https://www.w3.org/TR/png/), [WebP RIFF container specification](https://developers.google.com/speed/webp/docs/riff_container). Deployment follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
