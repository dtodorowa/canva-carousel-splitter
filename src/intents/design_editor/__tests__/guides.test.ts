import { openDesign } from "@canva/design";
import {
  GUIDE_COLOR,
  SAFE_MARGIN_FRACTION,
  buildGuideGroup,
  guideLines,
  isGuideElement,
  removeGuides,
} from "../guides";

const PAGE = { width: 3240, height: 1350 };

const solid = (color: string) => ({
  fill: { colorContainer: { type: "solid", color } },
});

/** A shape carries a fill per path. */
const shape = (color: string) => ({
  type: "shape",
  paths: { toArray: () => [solid(color)] },
});

/** A rect carries one fill on the element itself. */
const rect = (color: string) => ({ type: "rect", ...solid(color) });

describe("guideLines", () => {
  it("marks every seam and flanks each with a margin pair", () => {
    const lines = guideLines(3, PAGE);
    const seams = lines.filter((l) => l.kind === "seam");
    const margins = lines.filter((l) => l.kind === "margin");

    expect(seams).toHaveLength(2);
    // Two per seam, plus one at each outer edge.
    expect(margins).toHaveLength(6);
  });

  it("puts seams exactly on the slide boundaries", () => {
    const seams = guideLines(4, PAGE)
      .filter((l) => l.kind === "seam")
      .map((l) => l.left + l.width / 2);

    expect(seams).toEqual([810, 1620, 2430]);
  });

  it("sets the margin from the slide width, not the page width", () => {
    const slideWidth = PAGE.width / 3;
    const expected = slideWidth * SAFE_MARGIN_FRACTION;
    const lines = guideLines(3, PAGE);
    const seam = 1080;

    const flanking = lines
      .filter((l) => l.kind === "margin")
      .map((l) => l.left + l.width / 2)
      .filter((centre) => Math.abs(centre - seam) < slideWidth / 2);

    expect(flanking).toHaveLength(2);
    expect(flanking[0]).toBeCloseTo(seam - expected);
    expect(flanking[1]).toBeCloseTo(seam + expected);
  });

  it("guards the outer edges too, since they crop as well", () => {
    const margin = (PAGE.width / 3) * SAFE_MARGIN_FRACTION;
    const centres = guideLines(3, PAGE)
      .filter((l) => l.kind === "margin")
      .map((l) => l.left + l.width / 2);

    expect(centres).toContainEqual(expect.closeTo(margin, 5));
    expect(centres).toContainEqual(expect.closeTo(PAGE.width - margin, 5));
  });

  it("stays proportional on a page that had to be scaled down", () => {
    const small = { width: 1620, height: 675 };
    const full = guideLines(3, PAGE).filter((l) => l.kind === "seam");
    const scaled = guideLines(3, small).filter((l) => l.kind === "seam");

    scaled.forEach((line, i) => {
      const a = (line.left + line.width / 2) / small.width;
      const b = ((full[i]?.left ?? 0) + (full[i]?.width ?? 0) / 2) / PAGE.width;

      expect(a).toBeCloseTo(b);
    });
  });

  it("never lands a guide outside the page", () => {
    for (let count = 2; count <= 10; count++) {
      for (const line of guideLines(count, PAGE)) {
        expect(line.left).toBeGreaterThanOrEqual(0);
        expect(line.left + line.width).toBeLessThanOrEqual(PAGE.width);
      }
    }
  });
});

describe("buildGuideGroup", () => {
  type Built = {
    type: string;
    top: number;
    left: number;
    width: number;
    height: number;
    children: {
      type: string;
      top: number;
      left: number;
      width: number;
      height: number;
    }[];
  };

  const built = (count: number, page = PAGE) =>
    buildGuideGroup(count, page) as unknown as Built;

  it("returns one group holding every guide", () => {
    const group = built(3);

    expect(group.type).toBe("group");
    expect(group.children).toHaveLength(guideLines(3, PAGE).length);
  });

  // Canva rejects a group whose placement aspect differs from its content's.
  it("sizes the group to exactly its children's bounding box", () => {
    for (let count = 2; count <= 10; count++) {
      const group = built(count);
      const lefts = group.children.map((c) => c.left);
      const rights = group.children.map((c) => c.left + c.width);
      const tops = group.children.map((c) => c.top);
      const bottoms = group.children.map((c) => c.top + c.height);

      expect(Math.min(...lefts)).toBeCloseTo(0);
      expect(Math.max(...rights)).toBeCloseTo(group.width);
      expect(Math.min(...tops)).toBeCloseTo(0);
      expect(Math.max(...bottoms)).toBeCloseTo(group.height);
    }
  });

  it("is narrower than the page, because the outer guides sit inside it", () => {
    const group = built(3);

    expect(group.width).toBeLessThan(PAGE.width);
    expect(group.left).toBeGreaterThan(0);
  });

  it("keeps the guides where the page wants them once the group is placed", () => {
    const group = built(3);
    const absolute = group.children.map((c) => group.left + c.left);

    expect(absolute).toEqual(
      guideLines(3, PAGE).map((line) => expect.closeTo(line.left, 5)),
    );
  });

  it("spans the full page height", () => {
    const group = built(4);

    expect(group.height).toBe(PAGE.height);
    expect(group.top).toBe(0);
  });

  it("fills every child with the sentinel colour", () => {
    expect(JSON.stringify(built(3))).toContain(GUIDE_COLOR);
  });

  it("always has enough children to be a group at all", () => {
    for (let count = 2; count <= 10; count++) {
      expect(built(count).children.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("isGuideElement", () => {
  it("recognises a guide that came back as a shape", () => {
    expect(isGuideElement(shape(GUIDE_COLOR))).toBe(true);
  });

  it("recognises a guide that came back as a rect", () => {
    expect(isGuideElement(rect(GUIDE_COLOR))).toBe(true);
  });

  it("matches regardless of hex casing", () => {
    expect(isGuideElement(shape(GUIDE_COLOR.toLowerCase()))).toBe(true);
    expect(isGuideElement(rect(GUIDE_COLOR.toLowerCase()))).toBe(true);
  });

  it("leaves the user's shapes alone", () => {
    expect(isGuideElement(shape("#FF0099"))).toBe(false);
    expect(isGuideElement(rect("#FF0099"))).toBe(false);
  });

  it("ignores elements with no fill to read", () => {
    expect(isGuideElement({ type: "text" })).toBe(false);
    expect(isGuideElement({ type: "image" })).toBe(false);
    expect(
      isGuideElement({
        type: "shape",
        paths: { toArray: () => [{ fill: { colorContainer: undefined } }] },
      }),
    ).toBe(false);
  });

  it("recognises the group the guides are added as", () => {
    const group = {
      type: "group",
      contents: { toArray: () => [shape(GUIDE_COLOR), shape(GUIDE_COLOR)] },
    };

    expect(isGuideElement(group)).toBe(true);
  });

  it("leaves a group of the user's own shapes alone", () => {
    const group = {
      type: "group",
      contents: { toArray: () => [shape("#123456"), rect("#654321")] },
    };

    expect(isGuideElement(group)).toBe(false);
  });

  it("still recognises loose guides drawn by an earlier version", () => {
    expect(isGuideElement(shape(GUIDE_COLOR))).toBe(true);
  });

  it("survives an element shaped nothing like the SDK's", () => {
    expect(isGuideElement(undefined)).toBe(false);
    expect(isGuideElement({})).toBe(false);
    expect(isGuideElement({ type: "shape", paths: {} })).toBe(false);
    expect(isGuideElement({ type: "group", contents: {} })).toBe(false);
  });

  describe("when Canva reports the element as unsupported", () => {
    const sliver = { type: "unsupported", top: 0, width: 4, height: 1350 };

    it("falls back to the shape a guide has", () => {
      expect(isGuideElement(sliver, 1350)).toBe(true);
    });

    it("needs the page height to risk that fallback", () => {
      expect(isGuideElement(sliver)).toBe(false);
    });

    it("spares anything that is not a full-height sliver", () => {
      expect(isGuideElement({ ...sliver, width: 400 }, 1350)).toBe(false);
      expect(isGuideElement({ ...sliver, height: 200 }, 1350)).toBe(false);
      expect(isGuideElement({ ...sliver, top: 300 }, 1350)).toBe(false);
    });
  });
});

describe("removeGuides", () => {
  const mockOpenDesign = jest.mocked(openDesign);

  const runWith = (elements: unknown[], pageHeight = PAGE.height) => {
    const deleted: unknown[] = [];
    const list = {
      toArray: () => elements,
      delete: (item: unknown) => deleted.push(item),
    };
    const sync = jest.fn().mockResolvedValue(undefined);

    mockOpenDesign.mockImplementation((async (
      _options: unknown,
      callback: (session: unknown) => Promise<void>,
    ) => {
      await callback({
        page: {
          type: "absolute",
          dimensions: { width: PAGE.width, height: pageHeight },
          elements: list,
        },
        helpers: {},
        sync,
      });
    }) as unknown as typeof openDesign);

    return { deleted, sync };
  };

  beforeEach(() => jest.clearAllMocks());

  it("deletes shape guides and leaves everything else", async () => {
    const mine = shape(GUIDE_COLOR);
    const theirs = shape("#123456");
    const { deleted } = runWith([mine, theirs, { type: "text" }]);

    expect((await removeGuides()).removed).toBe(1);
    expect(deleted).toEqual([mine]);
  });

  it("deletes rect guides too, which is what was being missed", async () => {
    const mine = rect(GUIDE_COLOR);
    const { deleted } = runWith([mine, rect("#123456")]);

    expect((await removeGuides()).removed).toBe(1);
    expect(deleted).toEqual([mine]);
  });

  it("clears a whole set in one pass", async () => {
    const guides = [shape(GUIDE_COLOR), rect(GUIDE_COLOR), shape(GUIDE_COLOR)];
    const { deleted } = runWith([...guides, { type: "text" }]);

    expect((await removeGuides()).removed).toBe(3);
    expect(deleted).toHaveLength(3);
  });

  it("deletes the whole guide group as one element", async () => {
    const group = {
      type: "group",
      contents: { toArray: () => [shape(GUIDE_COLOR), shape(GUIDE_COLOR)] },
    };
    const { deleted } = runWith([group, { type: "text" }]);

    expect((await removeGuides()).removed).toBe(1);
    expect(deleted).toEqual([group]);
  });

  it("persists the deletion", async () => {
    const { sync } = runWith([shape(GUIDE_COLOR)]);

    await removeGuides();

    expect(sync).toHaveBeenCalled();
  });

  it("does not touch the design when there is nothing to remove", async () => {
    const { deleted, sync } = runWith([shape("#123456")]);

    expect((await removeGuides()).removed).toBe(0);
    expect(deleted).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it("reports what it saw, so a miss can be explained", async () => {
    runWith([rect("#123456"), { type: "text" }]);

    const { removed, seen } = await removeGuides();

    expect(removed).toBe(0);
    expect(seen).toEqual(["rect #123456", "text"]);
  });

  it("does nothing on a page type it cannot edit", async () => {
    const sync = jest.fn();
    mockOpenDesign.mockImplementation((async (
      _options: unknown,
      callback: (session: unknown) => Promise<void>,
    ) => {
      await callback({ page: { type: "unsupported" }, helpers: {}, sync });
    }) as unknown as typeof openDesign);

    expect((await removeGuides()).removed).toBe(0);
    expect(sync).not.toHaveBeenCalled();
  });
});
