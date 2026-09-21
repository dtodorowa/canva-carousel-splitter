import {
  MAX_SLIDES,
  MIN_SLIDES,
  CANVA_MAX_PAGE_AREA,
  CANVA_MAX_PAGE_SIDE,
  PORTRAIT,
  SLIDE_FORMATS,
  SQUARE,
  clampSlideCount,
  compositeSize,
  cropWaste,
  exceedsCanvasLimit,
  fitCover,
  planCarouselPage,
  suggestSlideCount,
} from "../slicer";

const portrait = PORTRAIT;
const square = SQUARE;

describe("fitCover", () => {
  it("fills the target exactly when aspect ratios match", () => {
    const fit = fitCover(
      { width: 2160, height: 2700 },
      { width: 1080, height: 1350 },
    );

    expect(fit.scale).toBeCloseTo(0.5);
    expect(fit.drawWidth).toBeCloseTo(1080);
    expect(fit.drawHeight).toBeCloseTo(1350);
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo(0);
  });

  it("overflows and centers when the source is too tall", () => {
    const fit = fitCover(
      { width: 1000, height: 2000 },
      { width: 1000, height: 1000 },
    );

    expect(fit.drawHeight).toBeCloseTo(2000);
    expect(fit.offsetY).toBeCloseTo(-500);
    expect(fit.offsetX).toBeCloseTo(0);
  });

  it("overflows and centers when the source is too wide", () => {
    const fit = fitCover(
      { width: 4000, height: 1000 },
      { width: 1000, height: 1000 },
    );

    expect(fit.drawWidth).toBeCloseTo(4000);
    expect(fit.offsetX).toBeCloseTo(-1500);
  });

  it("never leaves a gap, whatever the source aspect", () => {
    const target = { width: 3240, height: 1350 };

    for (const source of [
      { width: 100, height: 4000 },
      { width: 4000, height: 100 },
      { width: 3240, height: 1350 },
      { width: 1, height: 1 },
    ]) {
      const fit = fitCover(source, target);
      expect(fit.drawWidth).toBeGreaterThanOrEqual(target.width - 1e-6);
      expect(fit.drawHeight).toBeGreaterThanOrEqual(target.height - 1e-6);
    }
  });
});

describe("suggestSlideCount", () => {
  it("reads the slide count off an exactly-sized image", () => {
    expect(suggestSlideCount({ width: 3240, height: 1350 }, portrait)).toBe(3);
    expect(suggestSlideCount({ width: 5400, height: 1350 }, portrait)).toBe(5);
    expect(suggestSlideCount({ width: 4320, height: 1080 }, square)).toBe(4);
  });

  it("rounds a near-miss to the closest whole slide", () => {
    expect(suggestSlideCount({ width: 3300, height: 1350 }, portrait)).toBe(3);
    expect(suggestSlideCount({ width: 3100, height: 1350 }, portrait)).toBe(3);
  });

  it("stays within the allowed range", () => {
    expect(suggestSlideCount({ width: 100, height: 4000 }, portrait)).toBe(
      MIN_SLIDES,
    );
    expect(suggestSlideCount({ width: 40000, height: 400 }, portrait)).toBe(
      MAX_SLIDES,
    );
  });
});

describe("clampSlideCount", () => {
  it("clamps, rounds, and survives garbage", () => {
    expect(clampSlideCount(0)).toBe(MIN_SLIDES);
    expect(clampSlideCount(99)).toBe(MAX_SLIDES);
    expect(clampSlideCount(3.4)).toBe(3);
    expect(clampSlideCount(Number.NaN)).toBe(MIN_SLIDES);
  });
});

describe("compositeSize", () => {
  it("multiplies width by slide count and keeps the height", () => {
    expect(compositeSize(4, portrait)).toEqual({ width: 4320, height: 1350 });
  });
});

describe("cropWaste", () => {
  it("reports no waste for a perfectly proportioned source", () => {
    const { fraction } = cropWaste({ width: 3240, height: 1350 }, 3, portrait);

    expect(fraction).toBeCloseTo(0);
  });

  it("reports roughly half wasted when the source is twice as tall as it needs", () => {
    const { fraction } = cropWaste({ width: 3240, height: 2700 }, 3, portrait);

    expect(fraction).toBeCloseTo(0.5);
  });

  // Verified against the real canvas: a 3000x1600 source cover-fitted to
  // 3240x1350 scales by 1.08, so 1728-1350 = 378 rows of the scaled image fall
  // outside the slides.
  it("matches the browser for a real mismatched source", () => {
    const { fraction } = cropWaste({ width: 3000, height: 1600 }, 3, portrait);

    expect(fraction).toBeCloseTo(0.21875, 5);
  });

  it("hands back the target size so the UI can suggest it", () => {
    const { target } = cropWaste({ width: 100, height: 100 }, 5, portrait);

    expect(target).toEqual({ width: 5400, height: 1350 });
  });
});

describe("exceedsCanvasLimit", () => {
  it("allows a normal carousel", () => {
    expect(exceedsCanvasLimit(10, portrait)).toBe(false);
  });

  it("rejects a composite wider than the browser canvas cap", () => {
    const wide = { id: "wide", width: 8000, height: 1350 };

    expect(exceedsCanvasLimit(10, wide)).toBe(true);
  });
});

describe("planCarouselPage", () => {
  it("uses the full slide resolution while Canva allows it", () => {
    expect(planCarouselPage(3, portrait)).toEqual({
      width: 3240,
      height: 1350,
      scale: 1,
    });
    expect(planCarouselPage(4, portrait)).toMatchObject({ width: 4320 });
    expect(planCarouselPage(6, portrait)).toMatchObject({ width: 6480 });
  });

  it("still fits seven 1080px slides, the widest run Canva will take", () => {
    expect(planCarouselPage(7, portrait)).toEqual({
      width: 7560,
      height: 1350,
      scale: 1,
    });
  });

  it("scales down rather than refusing once the run is too wide", () => {
    const plan = planCarouselPage(8, portrait);

    expect(plan.scale).toBeLessThan(1);
    expect(plan.width).toBe(CANVA_MAX_PAGE_SIDE);
    expect(plan.height).toBe(1250);
  });

  it("never proposes a page Canva would reject", () => {
    for (const format of SLIDE_FORMATS) {
      for (let count = MIN_SLIDES; count <= MAX_SLIDES; count++) {
        const plan = planCarouselPage(count, format);

        expect(plan.width).toBeLessThanOrEqual(CANVA_MAX_PAGE_SIDE);
        expect(plan.height).toBeLessThanOrEqual(CANVA_MAX_PAGE_SIDE);
        expect(plan.width * plan.height).toBeLessThanOrEqual(
          CANVA_MAX_PAGE_AREA,
        );
        expect(plan.width).toBeGreaterThanOrEqual(40);
        expect(plan.height).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it("keeps the carousel aspect ratio when it scales down", () => {
    const plan = planCarouselPage(10, portrait);
    const wanted = (10 * portrait.width) / portrait.height;

    expect(plan.width / plan.height).toBeCloseTo(wanted, 1);
  });
});
