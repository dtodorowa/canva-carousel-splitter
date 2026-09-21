/**
 * Geometry and canvas work for turning one wide image into N carousel slides.
 *
 * The geometry half is kept free of DOM APIs so it can be unit tested; the
 * canvas half only runs in the browser.
 */

export type SlideFormat = {
  id: string;
  width: number;
  height: number;
};

export const PORTRAIT: SlideFormat = {
  id: "portrait",
  width: 1080,
  height: 1350,
};
export const SQUARE: SlideFormat = { id: "square", width: 1080, height: 1080 };
export const STORY: SlideFormat = { id: "story", width: 1080, height: 1920 };

export const SLIDE_FORMATS: readonly SlideFormat[] = [PORTRAIT, SQUARE, STORY];

export const DEFAULT_FORMAT = PORTRAIT;

export const MIN_SLIDES = 2;
export const MAX_SLIDES = 10;

/**
 * Canva rejects pages outside 40-8000px per side or over 25M px of area.
 * Our per-slide sizes are well inside that, but the composite canvas we build
 * first is N times wider, and browsers cap canvas area too.
 */
export const MAX_CANVAS_AREA = 268_435_456; // 16384^2, the common browser cap

/** `upload()` caps data URLs at 10MB of characters. Leave room for the header. */
export const MAX_DATA_URL_CHARS = 10 * 1024 * 1024 - 1024;

export type Size = { width: number; height: number };

export type CoverFit = {
  scale: number;
  drawWidth: number;
  drawHeight: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Scale `source` to fully cover `target`, centering whatever spills over.
 *
 * Cover rather than contain: a near-miss aspect ratio should lose a few pixels
 * off the edge instead of gaining letterbox bars that then bake into the slides.
 */
export function fitCover(source: Size, target: Size): CoverFit {
  const scale = Math.max(
    target.width / source.width,
    target.height / source.height,
  );
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;

  return {
    scale,
    drawWidth,
    drawHeight,
    offsetX: (target.width - drawWidth) / 2,
    offsetY: (target.height - drawHeight) / 2,
  };
}

/** Total canvas a run of `count` slides occupies. */
export function compositeSize(count: number, format: SlideFormat): Size {
  return { width: format.width * count, height: format.height };
}

/**
 * Best guess at how many slides the user drew, from how much wider the image
 * is than a single slide.
 */
export function suggestSlideCount(source: Size, format: SlideFormat): number {
  const sourceRatio = source.width / source.height;
  const slideRatio = format.width / format.height;
  const raw = Math.round(sourceRatio / slideRatio);

  return clampSlideCount(raw);
}

export function clampSlideCount(count: number): number {
  if (!Number.isFinite(count)) {
    return MIN_SLIDES;
  }

  return Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Math.round(count)));
}

/**
 * How much of the source image gets cropped away, 0-1. Surfaced in the UI so a
 * badly-matched image is visible before it reaches the design.
 */
export function cropWaste(source: Size, count: number, format: SlideFormat) {
  const target = compositeSize(count, format);
  const { drawWidth, drawHeight } = fitCover(source, target);
  const visible = target.width * target.height;
  const drawn = drawWidth * drawHeight;

  return { fraction: 1 - visible / drawn, target };
}

/** Canva rejects pages outside these bounds. */
export const CANVA_MAX_PAGE_SIDE = 8000;
export const CANVA_MAX_PAGE_AREA = 25_000_000;

export type CarouselPagePlan = {
  width: number;
  height: number;
  /** 1 when the carousel fits at full slide resolution, less when scaled down. */
  scale: number;
};

/**
 * The blank page to draw a whole carousel on.
 *
 * Past seven 1080px slides the run is wider than Canva allows a page to be, so
 * rather than refuse, scale the page down and let the artwork be drawn smaller.
 * Slicing upscales it back, which costs sharpness but keeps the workflow.
 */
export function planCarouselPage(
  count: number,
  format: SlideFormat,
): CarouselPagePlan {
  const full = compositeSize(count, format);
  const scale = Math.min(
    1,
    CANVA_MAX_PAGE_SIDE / full.width,
    CANVA_MAX_PAGE_SIDE / full.height,
    Math.sqrt(CANVA_MAX_PAGE_AREA / (full.width * full.height)),
  );

  return {
    width: Math.floor(full.width * scale),
    height: Math.floor(full.height * scale),
    scale,
  };
}

export function exceedsCanvasLimit(
  count: number,
  format: SlideFormat,
): boolean {
  const { width, height } = compositeSize(count, format);

  return width * height > MAX_CANVAS_AREA || width > 16384;
}

// --- canvas ---------------------------------------------------------------

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  return canvas;
}

/**
 * Draw the source once at full carousel width. Slices are then cheap crops of
 * this, which keeps resampling identical across slides — scaling each slide
 * separately leaves visible seams where a gradient or line crosses a boundary.
 */
export function renderComposite(
  source: CanvasImageSource & Size,
  count: number,
  format: SlideFormat,
): HTMLCanvasElement {
  const target = compositeSize(count, format);
  const canvas = createCanvas(target.width, target.height);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Could not get a 2D canvas context");
  }

  const fit = fitCover(source, target);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    fit.offsetX,
    fit.offsetY,
    fit.drawWidth,
    fit.drawHeight,
  );

  return canvas;
}

export type EncodedImage = {
  dataUrl: string;
  thumbnailUrl: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
};

/**
 * Thrown when the source image came from a host that sends no CORS headers, so
 * the browser refuses to let us read the pixels back out of the canvas.
 */
export class TaintedSourceError extends Error {
  constructor() {
    super(
      "This image can't be read back out of the canvas because of browser security rules. Use Linked mode, which doesn't need to read the pixels.",
    );
    this.name = "TaintedSourceError";
  }
}

function toDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): string {
  try {
    return canvas.toDataURL(mimeType, quality);
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      throw new TaintedSourceError();
    }

    throw error;
  }
}

/**
 * PNG first for clean edges on flat art, falling back to JPEG only when PNG
 * would blow the 10MB data URL cap that `upload()` enforces.
 */
function encode(canvas: HTMLCanvasElement): {
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg";
} {
  const png = toDataUrl(canvas, "image/png");

  if (png.length <= MAX_DATA_URL_CHARS) {
    return { dataUrl: png, mimeType: "image/png" };
  }

  for (const quality of [0.92, 0.85, 0.75, 0.6]) {
    const jpeg = toDataUrl(canvas, "image/jpeg", quality);

    if (jpeg.length <= MAX_DATA_URL_CHARS) {
      return { dataUrl: jpeg, mimeType: "image/jpeg" };
    }
  }

  throw new Error(
    "This image is too large to upload even as a compressed JPEG. Try fewer slides or a smaller source image.",
  );
}

/** Small JPEG for `thumbnailUrl`, so the thumbnail never eats into the cap. */
function encodeThumbnail(canvas: HTMLCanvasElement, maxWidth = 320): string {
  const scale = Math.min(1, maxWidth / canvas.width);
  const thumb = createCanvas(
    Math.max(1, Math.round(canvas.width * scale)),
    Math.max(1, Math.round(canvas.height * scale)),
  );
  const ctx = thumb.getContext("2d");

  if (!ctx) {
    throw new Error("Could not get a 2D canvas context");
  }

  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);

  return toDataUrl(thumb, "image/jpeg", 0.8);
}

export function encodeCanvas(canvas: HTMLCanvasElement): EncodedImage {
  const { dataUrl, mimeType } = encode(canvas);

  return {
    dataUrl,
    thumbnailUrl: encodeThumbnail(canvas),
    mimeType,
    width: canvas.width,
    height: canvas.height,
  };
}

/** Crop slide `index` out of a rendered composite. */
export function extractSlide(
  composite: HTMLCanvasElement,
  index: number,
  format: SlideFormat,
): HTMLCanvasElement {
  const canvas = createCanvas(format.width, format.height);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Could not get a 2D canvas context");
  }

  ctx.drawImage(
    composite,
    index * format.width,
    0,
    format.width,
    format.height,
    0,
    0,
    format.width,
    format.height,
  );

  return canvas;
}

/**
 * `crossOrigin` decides whether the decoded image can be read back after it is
 * drawn. Requesting it fails outright on hosts that send no CORS headers, so
 * callers that only need dimensions ask for it off.
 */
export async function loadImageFromUrl(
  url: string,
  { crossOrigin }: { crossOrigin: boolean },
): Promise<HTMLImageElement> {
  const image = new Image();

  if (crossOrigin) {
    image.crossOrigin = "anonymous";
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(
        crossOrigin
          ? new TaintedSourceError()
          : new Error("Could not load the image."),
      );
    image.src = url;
  });

  await image.decode().catch(() => undefined);

  return image;
}

export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Could not read ${file.name}`));
      image.src = url;
    });

    // decode() before revoking guarantees the bitmap is resident, otherwise
    // drawImage can race the object URL being torn down in Safari.
    await image.decode().catch(() => undefined);

    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
