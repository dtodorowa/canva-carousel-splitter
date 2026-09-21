import { openDesign } from "@canva/design";
import {
  GUIDE_COLOR,
  SAFE_MARGIN_FRACTION,
  buildGuideElements,
  guideLines,
  isGuideElement,
  removeGuides,
} from "../guides";

const PAGE = { width: 3240, height: 1350 };

const solid = (color: string) => ({
  fill: { colorContainer: { type: "solid", color } },
});

const shape = (color: string) => ({
  type: "shape",
  paths: { toArray: () => [solid(color)] },
});

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

describe("buildGuideElements", () => {
  it("makes one full-height shape per guide, in the sentinel colour", () => {
    const elements = buildGuideElements(3, PAGE);

    expect(elements).toHaveLength(guideLines(3, PAGE).length);

    for (const element of elements) {
      expect(element).toMatchObject({ type: "shape", top: 0 });
      expect((element as { height: number }).height).toBe(PAGE.height);
      expect(JSON.stringify(element)).toContain(GUIDE_COLOR);
    }
  });
});

describe("isGuideElement", () => {
  it("recognises its own guides", () => {
    expect(isGuideElement(shape(GUIDE_COLOR))).toBe(true);
  });

  it("matches regardless of hex casing", () => {
    expect(isGuideElement(shape(GUIDE_COLOR.toLowerCase()))).toBe(true);
  });

  it("leaves the user's shapes alone", () => {
    expect(isGuideElement(shape("#FF0099"))).toBe(false);
  });

  it("ignores elements that are not shapes", () => {
    expect(isGuideElement({ type: "text" })).toBe(false);
    expect(isGuideElement({ type: "image" })).toBe(false);
  });

  it("survives a shape with no solid fill", () => {
    expect(
      isGuideElement({
        type: "shape",
        paths: { toArray: () => [{ fill: { colorContainer: undefined } }] },
      }),
    ).toBe(false);
  });
});

describe("removeGuides", () => {
  const mockOpenDesign = jest.mocked(openDesign);

  const runWith = (elements: unknown[]) => {
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
        page: { type: "absolute", elements: list },
        helpers: {},
        sync,
      });
    }) as unknown as typeof openDesign);

    return { deleted, sync };
  };

  beforeEach(() => jest.clearAllMocks());

  it("deletes the guides and leaves everything else", async () => {
    const mine = shape(GUIDE_COLOR);
    const theirs = shape("#123456");
    const text = { type: "text" };
    const { deleted } = runWith([mine, theirs, text]);

    const removed = await removeGuides();

    expect(removed).toBe(1);
    expect(deleted).toEqual([mine]);
  });

  it("persists the deletion", async () => {
    const { sync } = runWith([shape(GUIDE_COLOR)]);

    await removeGuides();

    expect(sync).toHaveBeenCalled();
  });

  it("does not touch the design when there is nothing to remove", async () => {
    const { deleted, sync } = runWith([shape("#123456")]);

    expect(await removeGuides()).toBe(0);
    expect(deleted).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it("does nothing on a page type it cannot edit", async () => {
    const sync = jest.fn();
    mockOpenDesign.mockImplementation((async (
      _options: unknown,
      callback: (session: unknown) => Promise<void>,
    ) => {
      await callback({ page: { type: "unsupported" }, helpers: {}, sync });
    }) as unknown as typeof openDesign);

    expect(await removeGuides()).toBe(0);
    expect(sync).not.toHaveBeenCalled();
  });
});
