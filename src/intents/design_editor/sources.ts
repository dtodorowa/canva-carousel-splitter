import type { ImageRef } from "@canva/asset";
import { getTemporaryUrl } from "@canva/asset";
import { requestExport, selection } from "@canva/design";
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
 * The open design, exported as a PNG.
 *
 * `zipped: "never"` gives one URL per page rather than a ZIP we would have to
 * unpack; we take the first page, which is the wide artwork in the workflow
 * this app is for.
 */
export async function sourceFromDesign(): Promise<CarouselSource> {
  const response = await requestExport({
    acceptedFileTypes: [{ type: "png", zipped: "never" }],
  });

  if (response.status === "aborted") {
    throw new ExportAbortedError("Export was cancelled.");
  }

  const first = response.exportBlobs[0];

  if (!first) {
    throw new Error("The export came back empty.");
  }

  return {
    kind: "design",
    label: response.title ?? "",
    ...(await measure(first.url)),
    previewUrl: first.url,
    mimeType: "image/png",
    pageCount: response.exportBlobs.length,
    loadPixels: memo(() => loadImageFromUrl(first.url, { crossOrigin: true })),
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
