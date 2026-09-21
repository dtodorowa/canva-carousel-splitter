import { pickCurrentPage } from "../sources";

const page = (width: number, height: number, url = `${width}x${height}`) => ({
  url,
  width,
  height,
});

const POST = page(1080, 1350);
const CAROUSEL = page(3240, 1350);
const STORY = page(1080, 1920);

describe("pickCurrentPage", () => {
  it("takes the only page without calling it a guess", () => {
    const result = pickCurrentPage([CAROUSEL], { width: 3240, height: 1350 });

    expect(result).toEqual({ page: CAROUSEL, index: 0, ambiguous: false });
  });

  it("finds the page the user is on among differently shaped ones", () => {
    const result = pickCurrentPage([POST, CAROUSEL, STORY], {
      width: 3240,
      height: 1350,
    });

    expect(result.index).toBe(1);
    expect(result.ambiguous).toBe(false);
  });

  it("does not just take the widest page", () => {
    const result = pickCurrentPage([POST, CAROUSEL], {
      width: 1080,
      height: 1350,
    });

    expect(result.index).toBe(0);
  });

  it("matches on shape, since exports come back at their own scale", () => {
    // The same pages exported at 2x: ratios are identical, sizes are not.
    const exported = [page(2160, 2700), page(6480, 2700)];

    const result = pickCurrentPage(exported, { width: 3240, height: 1350 });

    expect(result.index).toBe(1);
    expect(result.ambiguous).toBe(false);
  });

  it("flags a guess when two pages are the same shape", () => {
    const result = pickCurrentPage([CAROUSEL, page(3240, 1350, "other")], {
      width: 3240,
      height: 1350,
    });

    expect(result.ambiguous).toBe(true);
  });

  it("falls back to the widest page when the design type has no dimensions", () => {
    const result = pickCurrentPage([POST, CAROUSEL, STORY], undefined);

    expect(result.index).toBe(1);
    expect(result.ambiguous).toBe(true);
  });

  it("settles on the nearest shape when nothing matches exactly", () => {
    const result = pickCurrentPage([POST, CAROUSEL], {
      width: 3200,
      height: 1400,
    });

    expect(result.index).toBe(1);
  });

  it("refuses an empty export rather than returning nothing", () => {
    expect(() => pickCurrentPage([], undefined)).toThrow();
  });
});
