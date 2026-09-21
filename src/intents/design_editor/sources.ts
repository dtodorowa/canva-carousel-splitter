import type { ImageRef } from "@canva/asset";
import { getTemporaryUrl } from "@canva/asset";
import { getCurrentPageContext, requestExport, selection } from "@canva/design";
import { loadImage, loadImageFromUrl } from "./slicer";

export type SourceKind = "upload" | "design" | "selection";

/**
 * Where the carousel artwork comes from.
 *
 * `ref` is the interesting field: when the artwork is already an asset in the
 * user's Canva account, linked mode can reuse it directly and never touch the
 * pixels — no download, no re-upload, no canvas.
 */
export type CarouselSource = {
  kind: SourceKind;
  /** Natural title, e.g. a filename. Empty when the UI should name it. */
  label: string;
  width: number;
  height: number;
  /** Displayable in an `<img>`. Display never needs CORS; reading pixels does. */
  previewUrl: string;
  ref?: ImageRef;
  /** Set when `previewUrl` is a URL Canva could upload from directly. */
  mimeType?: "image/png" | "image/jpeg";
  /** Pages in the exported design, so the UI can say which one it took. */
  pageCount?: number;
  /** Zero-based index of the page that was chosen. */
  pageIndex?: number;
  /** True when several pages were the same shape and the match was a guess. */
  pageAmbiguous?: boolean;
  /** Decoded pixels, for slicing. Rejects when the URL is not CORS-readable. */
  loadPixels: () => Promise<HTMLImageElement>;
};

export class NoSelectionError extends Error {}
export class ExportAbortedError extends Error {}

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;

  return () => (pending ??= fn());
}

export async function sourceFromFile(file: File): Promise<CarouselSource> {
  const image = await loadImage(file);

  return {
    kind: "upload",
    label: file.name,
    width: image.naturalWidth,
    height: image.naturalHeight,
    previewUrl: image.src,
    loadPixels: async () => image,
  };
}

/**
 * The image the user currently has selected on the canvas.
 *
 * Carries the asset's own ref, so linked mode can spread it across pages
 * without a round trip through the browser.
 */
export async function sourceFromSelection(): Promise<CarouselSource> {
  const event = await new Promise<Awaited<ReturnType<typeof readOnce>>>(
    (resolve, reject) => {
      const dispose = selection.registerOnChange({
        scope: "image",
        onChange: async (e) => {
          dispose();

          if (e.count === 0) {
            reject(new NoSelectionError("No image is selected."));

            return;
          }

          try {
            resolve(await readOnce(e));
          } catch (error) {
            reject(error);
          }
        },
      });
    },
  );

  const ref = event.ref;
  const { url } = await getTemporaryUrl({ type: "image", ref });

  return {
    kind: "selection",
    label: "",
    ...(await measure(url)),
    previewUrl: url,
    ref,
    loadPixels: memo(() => loadImageFromUrl(url, { crossOrigin: true })),
  };
}

type SelectionLike = {
  read: () => Promise<{ contents: readonly { ref: ImageRef }[] }>;
};

async function readOnce(event: SelectionLike): Promise<{ ref: ImageRef }> {
  const draft = await event.read();
  const first = draft.contents[0];

  if (!first) {
    throw new NoSelectionError("No image is selected.");
  }

  return { ref: first.ref };
}

/**
 * The page the user is looking at, exported as a PNG.
 *
 * `requestExport` only exports whole designs, and an `ExportBlob` carries a URL
 * and nothing else — no page id to match on. The current page's aspect ratio is
 * the only link back, so that is what we match. It separates a carousel page
 * from ordinary slides cleanly; it can only be fooled by a second page of
 * exactly the same shape, which the caller is told about.
 */
export async function sourceFromDesign(): Promise<CarouselSource> {
  const [context, response] = await Promise.all([
    getCurrentPageContext(),
    requestExport({ acceptedFileTypes: [{ type: "png", zipped: "never" }] }),
  ]);

  if (response.status === "aborted") {
    throw new ExportAbortedError("Export was cancelled.");
  }

  const blobs = response.exportBlobs;

  if (blobs.length === 0) {
    throw new Error("The export came back empty.");
  }

  const pages = await Promise.all(
    blobs.map(async (blob) => ({
      url: blob.url,
      ...(await measure(blob.url)),
    })),
  );
  const chosen = pickCurrentPage(pages, context.dimensions);

  return {
    kind: "design",
    label: response.title ?? "",
    width: chosen.page.width,
    height: chosen.page.height,
    previewUrl: chosen.page.url,
    mimeType: "image/png",
    pageCount: pages.length,
    pageIndex: chosen.index,
    pageAmbiguous: chosen.ambiguous,
    loadPixels: memo(() =>
      loadImageFromUrl(chosen.page.url, { crossOrigin: true }),
    ),
  };
}

type MeasuredPage = { url: string; width: number; height: number };

/**
 * Exports come back scaled, so compare shape rather than size. Without a
 * current page to match (docs and whiteboards report no dimensions) the widest
 * page is the best guess, because carousel artwork is the long one.
 */
export function pickCurrentPage(
  pages: readonly MeasuredPage[],
  current: { width: number; height: number } | undefined,
): { page: MeasuredPage; index: number; ambiguous: boolean } {
  const first = pages[0];

  if (!first) {
    throw new Error("The export came back empty.");
  }

  if (pages.length === 1) {
    return { page: first, index: 0, ambiguous: false };
  }

  const ratios = pages.map((page) => page.width / page.height);

  if (!current) {
    const widest = ratios.indexOf(Math.max(...ratios));

    return {
      page: pages[widest] as MeasuredPage,
      index: widest,
      ambiguous: true,
    };
  }

  const wanted = current.width / current.height;
  const distances = ratios.map((ratio) => Math.abs(ratio - wanted));
  const closest = Math.min(...distances);
  const best = distances.indexOf(closest);

  return {
    page: pages[best] as MeasuredPage,
    index: best,
    // Another page of the same shape means the aspect ratio could not tell
    // them apart.
    ambiguous: distances.filter((d) => Math.abs(d - closest) < 1e-6).length > 1,
  };
}

/**
 * Dimensions only. Loaded without `crossOrigin` so this works even when the
 * host sends no CORS headers — reading the pixels may still fail later.
 */
async function measure(
  url: string,
): Promise<{ width: number; height: number }> {
  const image = await loadImageFromUrl(url, { crossOrigin: false });

  return { width: image.naturalWidth, height: image.naturalHeight };
}
