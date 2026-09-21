import { openDesign } from "@canva/design";
import { GUIDE_COLOR } from "../guides";
import { readGroups, regionInImage } from "../groups";

const PAGE = { width: 3240, height: 1350 };

const group = (
  left: number,
  top: number,
  width: number,
  height: number,
  contents: unknown[] = [],
) => ({
  type: "group",
  left,
  top,
  width,
  height,
  contents: { toArray: () => contents },
});

const guideChild = {
  type: "shape",
  paths: {
    toArray: () => [
      { fill: { colorContainer: { type: "solid", color: GUIDE_COLOR } } },
    ],
  },
};

const mockOpenDesign = jest.mocked(openDesign);

const pageWith = (elements: unknown[], dimensions = PAGE) => {
  mockOpenDesign.mockImplementation((async (
    _options: unknown,
    callback: (session: unknown) => Promise<void>,
  ) => {
    await callback({
      page: {
        type: "absolute",
        dimensions,
        elements: { toArray: () => elements, delete: jest.fn() },
      },
      helpers: {},
      sync: jest.fn(),
    });
  }) as unknown as typeof openDesign);
};

describe("readGroups", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the groups with their boxes, and the page size", async () => {
    pageWith([group(0, 0, 3240, 1350)]);

    const { groups, page } = await readGroups();

    expect(page).toEqual(PAGE);
    expect(groups).toEqual([
      { index: 0, region: { left: 0, top: 0, width: 3240, height: 1350 } },
    ]);
  });

  it("ignores everything that is not a group", async () => {
    pageWith([{ type: "text" }, group(10, 20, 100, 50), { type: "rect" }]);

    const { groups } = await readGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.index).toBe(1);
  });

  it("never offers its own guide overlay as artwork", async () => {
    pageWith([
      group(0, 0, 3240, 1350, [guideChild, guideChild]),
      group(100, 50, 800, 400),
    ]);

    const { groups } = await readGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.region.left).toBe(100);
  });

  it("keeps the index from the page, so same-sized groups stay distinct", async () => {
    pageWith([{ type: "text" }, group(0, 0, 100, 100), group(0, 0, 100, 100)]);

    const { groups } = await readGroups();

    expect(groups.map((g) => g.index)).toEqual([1, 2]);
  });

  it("skips groups with unusable geometry rather than offering a bad crop", async () => {
    pageWith([
      group(0, 0, 0, 100),
      group(0, 0, 100, -5),
      { type: "group", left: 0, top: 0 },
      group(0, 0, 100, 100),
    ]);

    const { groups } = await readGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.index).toBe(3);
  });

  it("returns nothing for a page type it cannot read", async () => {
    mockOpenDesign.mockImplementation((async (
      _options: unknown,
      callback: (session: unknown) => Promise<void>,
    ) => {
      await callback({
        page: { type: "unsupported" },
        helpers: {},
        sync: jest.fn(),
      });
    }) as unknown as typeof openDesign);

    await expect(readGroups()).resolves.toEqual({
      groups: [],
      page: undefined,
    });
  });
});

describe("regionInImage", () => {
  it("passes a region through unchanged when the export is 1:1", () => {
    const region = { left: 100, top: 50, width: 800, height: 400 };

    expect(regionInImage(region, PAGE, PAGE)).toEqual(region);
  });

  it("scales the region when the export came back larger", () => {
    const region = { left: 100, top: 50, width: 800, height: 400 };
    const image = { width: PAGE.width * 2, height: PAGE.height * 2 };

    expect(regionInImage(region, PAGE, image)).toEqual({
      left: 200,
      top: 100,
      width: 1600,
      height: 800,
    });
  });

  it("clamps a group that overhangs the page", () => {
    const region = { left: 3000, top: 1300, width: 800, height: 400 };

    const clamped = regionInImage(region, PAGE, PAGE);

    expect(clamped.left + clamped.width).toBeLessThanOrEqual(PAGE.width);
    expect(clamped.top + clamped.height).toBeLessThanOrEqual(PAGE.height);
  });

  it("pulls a negative offset back inside the image", () => {
    const region = { left: -200, top: -50, width: 800, height: 400 };

    const clamped = regionInImage(region, PAGE, PAGE);

    expect(clamped.left).toBe(0);
    expect(clamped.top).toBe(0);
  });

  it("never produces an empty crop", () => {
    const region = { left: 3239, top: 1349, width: 1, height: 1 };

    const clamped = regionInImage(region, PAGE, PAGE);

    expect(clamped.width).toBeGreaterThan(0);
    expect(clamped.height).toBeGreaterThan(0);
  });
});
