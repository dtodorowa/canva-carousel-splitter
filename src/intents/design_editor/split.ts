import { upload } from "@canva/asset";
import { addPage } from "@canva/design";
import type { SlideFormat } from "./slicer";
import { encodeCanvas, extractSlide, renderComposite } from "./slicer";

export type SplitMode =
  /** Every slide is cut out and uploaded as its own image. */
  | "slice"
  /** One image spans all pages; each page shows a different window onto it. */
  | "overflow";

export type SplitRequest = {
  image: HTMLImageElement;
  count: number;
  format: SlideFormat;
  mode: SplitMode;
  /** Base name for uploaded assets, so they're findable in Uploads. */
  name: string;
  altTextFor: (index: number, total: number) => string;
  onProgress?: (done: number, total: number) => void;
};

export async function addSlidesToDesign({
  image,
  count,
  format,
  mode,
  name,
  altTextFor,
  onProgress,
}: SplitRequest): Promise<void> {
  const composite = renderComposite(image, count, format);
  const dimensions = { width: format.width, height: format.height };

  const altText = (index: number) => ({
    text: altTextFor(index, count),
    decorative: false,
  });

  if (mode === "overflow") {
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

    for (let i = 0; i < count; i++) {
      await addPage({
        dimensions,
        elements: [
          {
            type: "image",
            ref,
            altText: altText(i),
            top: 0,
            // Slide i shows the i-th window; everything else hangs off-page and
            // Canva clips it at the page boundary. Subtracting from 0 keeps the
            // first slide at +0 rather than -0.
            left: 0 - i * format.width,
            width: composite.width,
            height: composite.height,
          },
        ],
      });
      onProgress?.(i + 1, count);
    }

    return;
  }

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
      dimensions,
      elements: [
        {
          type: "image",
          ref,
          altText: altText(i),
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
