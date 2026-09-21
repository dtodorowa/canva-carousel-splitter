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

export function buildGuideElements(
  count: number,
  page: Size,
): ElementAtPoint[] {
  return guideLines(count, page).map(({ left, width }) => ({
    type: "shape",
    paths: [
      {
        d: `M 0 0 H ${width} V ${page.height} H 0 L 0 0`,
        fill: { dropTarget: false, color: GUIDE_COLOR },
      },
    ],
    viewBox: { top: 0, left: 0, width, height: page.height },
    top: 0,
    left,
    width,
    height: page.height,
  }));
}

type MaybeGuide = {
  type: string;
  paths?: { toArray: () => readonly { fill: PathFill }[] };
};

type PathFill = {
  colorContainer?: { type: string; color?: string } | undefined;
};

/** A shape whose fill is the sentinel colour is one of ours. */
export function isGuideElement(element: MaybeGuide): boolean {
  if (element.type !== "shape" || !element.paths) {
    return false;
  }

  return element.paths.toArray().some((path) => {
    const container = path.fill?.colorContainer;

    return (
      container?.type === "solid" &&
      container.color?.toUpperCase() === GUIDE_COLOR
    );
  });
}

/**
 * Strip the guides off the current page.
 *
 * Called before the page is exported, so guides can never end up baked into a
 * slide. Returns how many were removed so the caller can put them back if the
 * split then fails.
 */
export async function removeGuides(): Promise<number> {
  let removed = 0;

  await openDesign({ type: "current_page" }, async (session) => {
    const page = session.page;

    if (page.type !== "absolute") {
      return;
    }

    for (const element of page.elements.toArray()) {
      if (isGuideElement(element as unknown as MaybeGuide)) {
        page.elements.delete(element);
        removed++;
      }
    }

    if (removed > 0) {
      await session.sync();
    }
  });

  return removed;
}
