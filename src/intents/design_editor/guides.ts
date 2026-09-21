import type { ElementAtPoint } from "@canva/design";
import { openDesign } from "@canva/design";
import type { Size } from "./slicer";

/**
 * Guide lines drawn on a blank carousel page, so the slide boundaries are
 * visible while the artwork is being drawn.
 *
 * Canva's own guides would be the right tool — they show on the canvas and
 * never export — but the Apps SDK has no API for them. These are real shape
 * elements, so they would appear in the exported artwork; the split flow
 * removes them first.
 *
 * Every guide is filled with one unlikely colour, which is how they are found
 * again. Matching on colour rather than position means a guide that has been
 * nudged is still recognised and still cleaned up.
 */
export const GUIDE_COLOR = "#FF3DDA";

const SEAM_WIDTH = 4;
const MARGIN_WIDTH = 2;

/** Keep artwork this far from a seam, as a fraction of one slide's width. */
export const SAFE_MARGIN_FRACTION = 0.06;

export type GuideLine = {
  left: number;
  width: number;
  kind: "seam" | "margin";
};

/**
 * Positions in page coordinates. Derived from fractions of the page, so a page
 * that had to be scaled down still gets guides in the right places.
 */
export function guideLines(count: number, page: Size): GuideLine[] {
  const slideWidth = page.width / count;
  const margin = slideWidth * SAFE_MARGIN_FRACTION;
  const lines: GuideLine[] = [];

  for (let i = 1; i < count; i++) {
    const seam = i * slideWidth;

    lines.push({
      left: seam - SEAM_WIDTH / 2,
      width: SEAM_WIDTH,
      kind: "seam",
    });
    lines.push({
      left: seam - margin - MARGIN_WIDTH / 2,
      width: MARGIN_WIDTH,
      kind: "margin",
    });
    lines.push({
      left: seam + margin - MARGIN_WIDTH / 2,
      width: MARGIN_WIDTH,
      kind: "margin",
    });
  }

  // The outer edges crop too, so they need the same breathing room.
  lines.push({
    left: margin - MARGIN_WIDTH / 2,
    width: MARGIN_WIDTH,
    kind: "margin",
  });
  lines.push({
    left: page.width - margin - MARGIN_WIDTH / 2,
    width: MARGIN_WIDTH,
    kind: "margin",
  });

  return lines;
}

/**
 * All the guides as one group, so they are a single thing to select, move or
 * delete by hand — and a single thing to find again.
 *
 * Children are positioned relative to the group, and the group covers the whole
 * page, so the line positions carry over unchanged.
 */
export function buildGuideGroup(count: number, page: Size): ElementAtPoint {
  const lines = guideLines(count, page);
  const box = guideBounds(lines, page);

  return {
    type: "group",
    top: box.top,
    left: box.left,
    width: box.width,
    height: box.height,
    children: lines.map(({ left, width }) => ({
      type: "shape",
      paths: [
        {
          d: `M 0 0 H ${width} V ${box.height} H 0 L 0 0`,
          fill: { dropTarget: false, color: GUIDE_COLOR },
        },
      ],
      viewBox: { top: 0, left: 0, width, height: box.height },
      top: 0,
      // Children are positioned relative to the group.
      left: left - box.left,
      width,
      height: box.height,
    })),
  };
}

/**
 * The box the guides actually occupy.
 *
 * Canva rejects a group whose placement aspect ratio differs from that of its
 * content, so the group has to be the children's bounding box rather than the
 * whole page — the outermost guides sit a margin in from the page edges.
 */
export function guideBounds(
  lines: readonly GuideLine[],
  page: Size,
): { left: number; top: number; width: number; height: number } {
  const left = Math.min(...lines.map((line) => line.left));
  const right = Math.max(...lines.map((line) => line.left + line.width));

  return { left, top: 0, width: right - left, height: page.height };
}

/**
 * Every solid fill colour on an element, upper-cased.
 *
 * Rects carry one fill directly; shapes carry one per path. A guide added
 * through `addPage` can come back as either, so read both rather than assume.
 */
function solidColors(element: unknown, depth = 0): string[] {
  const found: string[] = [];
  const record = (fill: unknown) => {
    const container = (fill as { colorContainer?: unknown } | undefined)
      ?.colorContainer as { type?: string; color?: string } | undefined;

    if (container?.type === "solid" && typeof container.color === "string") {
      found.push(container.color.toUpperCase());
    }
  };

  const candidate = element as {
    fill?: unknown;
    paths?: { toArray?: () => readonly { fill?: unknown }[] };
  };

  record(candidate?.fill);

  if (typeof candidate?.paths?.toArray === "function") {
    for (const path of candidate.paths.toArray()) {
      record(path?.fill);
    }
  }

  // Guides are added as one group, so the fills live a level down. Bounded in
  // case a design nests groups deeply.
  const contents = (
    element as { contents?: { toArray?: () => readonly unknown[] } } | undefined
  )?.contents;

  if (depth < 4 && typeof contents?.toArray === "function") {
    for (const child of contents.toArray()) {
      found.push(...solidColors(child, depth + 1));
    }
  }

  return found;
}

/** A full-height sliver at the very top of the page, the shape a guide is. */
function looksLikeGuideGeometry(element: unknown, pageHeight: number): boolean {
  const { top, width, height } = (element ?? {}) as Partial<{
    top: number;
    width: number;
    height: number;
  }>;

  return (
    typeof top === "number" &&
    typeof width === "number" &&
    typeof height === "number" &&
    Math.abs(top) < 1 &&
    width <= 8 &&
    Math.abs(height - pageHeight) < 1
  );
}

/**
 * A guide is anything filled with the sentinel colour. An element Canva reports
 * as unsupported exposes no fill to check, so fall back to its shape — narrow
 * enough that only a full-height sliver qualifies.
 */
export function isGuideElement(element: unknown, pageHeight?: number): boolean {
  if (solidColors(element).includes(GUIDE_COLOR)) {
    return true;
  }

  const type = (element as { type?: string } | undefined)?.type;

  return (
    type === "unsupported" &&
    pageHeight != null &&
    looksLikeGuideGeometry(element, pageHeight)
  );
}

export type GuideScan = {
  removed: number;
  /** Element types found on the page, so a failed match can be diagnosed. */
  seen: string[];
};

export async function removeGuides(): Promise<GuideScan> {
  let removed = 0;
  const seen: string[] = [];

  await openDesign({ type: "current_page" }, async (session) => {
    const page = session.page;

    if (page.type !== "absolute") {
      seen.push(page.type);

      return;
    }

    const pageHeight = page.dimensions?.height;

    for (const element of page.elements.toArray()) {
      const described = describe(element);

      if (isGuideElement(element, pageHeight)) {
        page.elements.delete(element);
        removed++;
      } else {
        seen.push(described);
      }
    }

    if (removed > 0) {
      await session.sync();
    }
  });

  return { removed, seen };
}

/** Short label used only to explain why nothing matched. */
function describe(element: unknown): string {
  const type = (element as { type?: string } | undefined)?.type ?? "unknown";
  const colors = solidColors(element);

  return colors.length > 0 ? `${type} ${colors[0]}` : type;
}
