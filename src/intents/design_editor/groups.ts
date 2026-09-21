import { openDesign } from "@canva/design";
import { isGuideElement } from "./guides";
import type { Size } from "./slicer";

/** A rectangle in the coordinates of whatever contains it. */
export type Region = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PageGroup = {
  /** Position in the page's element list. Distinguishes same-sized groups. */
  index: number;
  region: Region;
};

/**
 * The groups on the current page, as candidates for the carousel artwork.
 *
 * An app can't see what the user has selected — `SelectionScope` covers only
 * image, video and text content — so the group is picked from a list instead.
 * Reading the page is the part that is possible.
 */
export async function readGroups(): Promise<{
  groups: PageGroup[];
  page: Size | undefined;
}> {
  const groups: PageGroup[] = [];
  let page: Size | undefined;

  await openDesign({ type: "current_page" }, async (session) => {
    const current = session.page;

    if (current.type !== "absolute") {
      return;
    }

    const dimensions = current.dimensions;
    page = dimensions
      ? { width: dimensions.width, height: dimensions.height }
      : undefined;

    current.elements.toArray().forEach((element, index) => {
      const candidate = element as unknown as Partial<Region> & {
        type?: string;
      };

      if (candidate.type !== "group") {
        return;
      }

      // The guide overlay is a group too, and never the artwork.
      if (isGuideElement(element, dimensions?.height)) {
        return;
      }

      const { left, top, width, height } = candidate;

      if (
        typeof left !== "number" ||
        typeof top !== "number" ||
        typeof width !== "number" ||
        typeof height !== "number" ||
        width <= 0 ||
        height <= 0
      ) {
        return;
      }

      groups.push({ index, region: { left, top, width, height } });
    });
  });

  return { groups, page };
}

/**
 * Move a region from page coordinates into the exported image's, and clamp it
 * to the image. Exports come back at their own resolution, and a group can
 * overhang the page edge.
 */
export function regionInImage(region: Region, page: Size, image: Size): Region {
  const scale = image.width / page.width;
  const left = Math.max(0, Math.round(region.left * scale));
  const top = Math.max(0, Math.round(region.top * scale));

  return {
    left,
    top,
    width: Math.max(
      1,
      Math.min(Math.round(region.width * scale), image.width - left),
    ),
    height: Math.max(
      1,
      Math.min(Math.round(region.height * scale), image.height - top),
    ),
  };
}
