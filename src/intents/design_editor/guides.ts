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
 * Reduce a colour to `#RRGGBB`, upper-cased.
 *
 * Canva may hand back a shorthand or an alpha suffix for a colour written as
 * plain six-digit hex, so comparing the strings directly is not safe.
 */
export function normalizeHex(color: string): string | undefined {
  const match = /^#?([0-9a-f]{3,8})$/i.exec(color.trim());

  if (!match?.[1]) {
    return undefined;
  }

  const digits = match[1].toUpperCase();

  if (digits.length === 3 || digits.length === 4) {
    return `#${digits
      .slice(0, 3)
      .split("")
      .map((d) => d + d)
      .join("")}`;
  }

  return digits.length >= 6 ? `#${digits.slice(0, 6)}` : undefined;
}

/**
 * Every solid fill colour on an element, normalised.
 *
 * Rects carry one fill directly, shapes carry one per path, and a group keeps
 * them a level down in its contents. A guide added through `addPage` can come
 * back as any of these, so read all of them rather than assume.
 */
function solidColors(element: unknown, depth = 0): string[] {
  const found: string[] = [];
  const record = (fill: unknown) => {
    const container = (fill as { colorContainer?: unknown } | undefined)
      ?.colorContainer as { type?: string; color?: string } | undefined;

    if (typeof container?.color === "string") {
      const hex = normalizeHex(container.color);

      if (hex) {
        found.push(hex);
      }
    }
  };

  const candidate = element as {
    fill?: unknown;
    paths?: { toArray?: () => readonly { fill?: unknown }[] };
    contents?: { toArray?: () => readonly unknown[] };
  };

  record(candidate?.fill);

  if (typeof candidate?.paths?.toArray === "function") {
    for (const path of candidate.paths.toArray()) {
      record(path?.fill);
    }
  }

  if (depth < 4 && typeof candidate?.contents?.toArray === "function") {
    for (const child of candidate.contents.toArray()) {
      found.push(...solidColors(child, depth + 1));
    }
  }

  return found;
}

function children(element: unknown): readonly unknown[] {
  const contents = (
    element as { contents?: { toArray?: () => readonly unknown[] } } | undefined
  )?.contents;

  return typeof contents?.toArray === "function" ? contents.toArray() : [];
}

/** A full-height sliver: the shape every guide has. */
function isSliver(element: unknown, pageHeight: number): boolean {
  const { width, height } = (element ?? {}) as Partial<{
    width: number;
    height: number;
  }>;

  return (
    typeof width === "number" &&
    typeof height === "number" &&
    width <= 8 &&
    Math.abs(height - pageHeight) < 2
  );
}

/**
 * A guide is anything filled with the sentinel colour.
 *
 * Failing that, fall back to shape: a group of nothing but full-height slivers
 * is what the guide overlay is, and what artwork rarely is. The fallback needs
 * the page height, so it is skipped when that is unknown.
 */
export function isGuideElement(element: unknown, pageHeight?: number): boolean {
  if (solidColors(element).includes(GUIDE_COLOR)) {
    return true;
  }

  if (pageHeight == null) {
    return false;
  }

  const kids = children(element);

  if (kids.length >= 3 && kids.every((kid) => isSliver(kid, pageHeight))) {
    return true;
  }

  const { type, top } = (element ?? {}) as { type?: string; top?: number };

  return (
    type === "unsupported" &&
    typeof top === "number" &&
    Math.abs(top) < 2 &&
    isSliver(element, pageHeight)
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
  const kids = children(element);
  const parts = [type];

  if (kids.length > 0) {
    const sizes = kids
      .slice(0, 3)
      .map((kid) => {
        const { type: kidType, width } = (kid ?? {}) as {
          type?: string;
          width?: number;
        };

        return `${kidType ?? "?"}${typeof width === "number" ? `:${Math.round(width)}w` : ""}`;
      })
      .join("/");

    parts.push(`[${kids.length}: ${sizes}]`);
  }

  parts.push(colors.length > 0 ? colors.slice(0, 2).join("/") : "no-fill");

  return parts.join(" ");
}
