import type { ImageRef } from "@canva/asset";
import { upload } from "@canva/asset";
import { addPage } from "@canva/design";
import type { SlideFormat } from "./slicer";
import {
  compositeSize,
  encodeCanvas,
  extractSlide,
  fitCover,
  renderComposite,
} from "./slicer";
import type { CarouselSource } from "./sources";

export type SplitMode =
  /** Every slide is cut out and uploaded as its own image. */
  | "slice"
  /** One image spans all pages; each page shows a different window onto it. */
  | "overflow";

export type SplitRequest = {
  source: CarouselSource;
  count: number;
  format: SlideFormat;
  mode: SplitMode;
  /** Base name for uploaded assets, so they're findable in Uploads. */
  name: string;
  altTextFor: (index: number, total: number) => string;
  onProgress?: (done: number, total: number) => void;
};

type PlacedAsset = {
  ref: ImageRef;
  /** Full size of the uploaded asset, which the region is expressed against. */
  width: number;
  height: number;
  region?: { left: number; top: number; width: number; height: number };
};

export async function addSlidesToDesign(request: SplitRequest): Promise<void> {
  if (request.mode === "overflow") {
    return addLinked(request);
  }

  return addSliced(request);
}

/**
 * One asset behind every page, positioned so each page frames its own slide.
 *
 * Canva does the scaling, which means an artwork already in the user's account
 * never has to be downloaded, re-encoded, or re-uploaded — and slicing a source
 * the browser isn't allowed to read still works.
 */
async function addLinked({
  source,
  count,
  format,
  name,
  altTextFor,
  onProgress,
}: SplitRequest): Promise<void> {
  const asset = await resolveLinkedAsset(source, count, format, name);
  const target = compositeSize(count, format);
  // Cover-fit the region, then express that as a placement of the whole asset,
  // so Canva's own scaling does the crop as well as the fit.
  const crop = asset.region ?? {
    left: 0,
    top: 0,
    width: asset.width,
    height: asset.height,
  };
  const fit = fitCover(crop, target);
  const scale = fit.drawWidth / crop.width;
  const placed = {
    width: asset.width * scale,
    height: asset.height * scale,
    left: fit.offsetX - crop.left * scale,
    top: fit.offsetY - crop.top * scale,
  };

  for (let i = 0; i < count; i++) {
    await addPage({
      dimensions: { width: format.width, height: format.height },
      elements: [
        {
          type: "image",
          ref: asset.ref,
          altText: { text: altTextFor(i, count), decorative: false },
          top: placed.top,
          // Slide i's window onto the artwork; the rest hangs off-page and
          // Canva clips it at the page boundary.
          left: placed.left - i * format.width,
          width: placed.width,
          height: placed.height,
        },
      ],
    });
    onProgress?.(i + 1, count);
  }
}

/**
 * Get the artwork into the design as a single asset, doing the least work the
 * source allows.
 */
async function resolveLinkedAsset(
  source: CarouselSource,
  count: number,
  format: SlideFormat,
  name: string,
): Promise<PlacedAsset> {
  // Already an asset in the user's account. Nothing to transfer.
  if (source.ref) {
    return {
      ref: source.ref,
      width: source.width,
      height: source.height,
      region: source.region,
    };
  }

  // A URL Canva's own servers can fetch, so the bytes never enter the browser.
  if (/^https?:/.test(source.previewUrl)) {
    const { ref } = await upload({
      type: "image",
      mimeType: source.mimeType ?? "image/png",
      url: source.previewUrl,
      thumbnailUrl: source.previewUrl,
      width: source.width,
      height: source.height,
      name,
      aiDisclosure: "none",
    });

    return {
      ref,
      width: source.width,
      height: source.height,
      region: source.region,
    };
  }

  // A local file. Flatten it to the carousel's exact size before uploading,
  // which also keeps it inside the 10MB data URL cap.
  // Flattening already applies the crop, so the upload needs no region.
  const composite = renderComposite(
    await source.loadPixels(),
    count,
    format,
    source.region,
  );
  const encoded = encodeCanvas(composite);
  const { ref } = await upload({
    type: "image",
    mimeType: encoded.mimeType,
    url: encoded.dataUrl,
    thumbnailUrl: encoded.thumbnailUrl,
    width: encoded.width,
    height: encoded.height,
    name,
    aiDisclosure: "none",
  });

  return { ref, width: encoded.width, height: encoded.height };
}

/** Cut the artwork into separate images, one asset and one page per slide. */
async function addSliced({
  source,
  count,
  format,
  name,
  altTextFor,
  onProgress,
}: SplitRequest): Promise<void> {
  const composite = renderComposite(
    await source.loadPixels(),
    count,
    format,
    source.region,
  );

  for (let i = 0; i < count; i++) {
    const encoded = encodeCanvas(extractSlide(composite, i, format));
    const { ref } = await upload({
      type: "image",
      mimeType: encoded.mimeType,
      url: encoded.dataUrl,
      thumbnailUrl: encoded.thumbnailUrl,
      width: encoded.width,
      height: encoded.height,
      name: `${name}-${i + 1}`,
      aiDisclosure: "none",
    });

    await addPage({
      dimensions: { width: format.width, height: format.height },
      elements: [
        {
          type: "image",
          ref,
          altText: { text: altTextFor(i, count), decorative: false },
          top: 0,
          left: 0,
          width: format.width,
          height: format.height,
        },
      ],
    });
    onProgress?.(i + 1, count);
  }
}
