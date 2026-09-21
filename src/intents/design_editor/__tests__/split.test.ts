/* eslint-disable formatjs/no-literal-string-in-object -- test fixtures, never shown to a user */
import type { ImageRef, ImageUploadOptions } from "@canva/asset";
import { upload } from "@canva/asset";
import { addPage } from "@canva/design";
import { PORTRAIT } from "../slicer";
import { encodeCanvas, extractSlide, renderComposite } from "../slicer";
import type { CarouselSource } from "../sources";
import type { SplitMode } from "../split";
import { addSlidesToDesign } from "../split";

// The canvas half of the slicer needs a real browser, so stub it and keep the
// geometry exports intact.
jest.mock("../slicer", () => ({
  ...jest.requireActual("../slicer"),
  renderComposite: jest.fn(),
  extractSlide: jest.fn(),
  encodeCanvas: jest.fn(),
}));

const mockRenderComposite = jest.mocked(renderComposite);
const mockExtractSlide = jest.mocked(extractSlide);
const mockEncodeCanvas = jest.mocked(encodeCanvas);
const mockUpload = jest.mocked(upload);
const mockAddPage = jest.mocked(addPage);

const COUNT = 3;
const WIDE = { width: PORTRAIT.width * COUNT, height: PORTRAIT.height };
const COMPOSITE = WIDE as HTMLCanvasElement;

/** A local file: no ref, and a blob URL Canva's servers could never fetch. */
const fileSource = (over: Partial<CarouselSource> = {}): CarouselSource => ({
  kind: "upload",
  label: "cascabelito.png",
  ...WIDE,
  previewUrl: "blob:localhost/abc",
  loadPixels: async () => ({}) as HTMLImageElement,
  ...over,
});

const request = (mode: SplitMode, source = fileSource()) => ({
  source,
  count: COUNT,
  format: PORTRAIT,
  mode,
  name: "cascabelito",
  altTextFor: (index: number, total: number) => `slide ${index + 1}/${total}`,
});

type PlacedElement = {
  ref: ImageRef;
  top: number;
  left: number;
  width: number;
  height: number;
};

const elements = () =>
  mockAddPage.mock.calls.map(
    ([opts]) => opts?.elements?.[0] as PlacedElement | undefined,
  );

describe("addSlidesToDesign", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRenderComposite.mockReturnValue(COMPOSITE);
    mockExtractSlide.mockReturnValue({} as HTMLCanvasElement);
    mockEncodeCanvas.mockReturnValue({
      dataUrl: "data:image/png;base64,AAA",
      thumbnailUrl: "data:image/jpeg;base64,BBB",
      mimeType: "image/png",
      ...WIDE,
    });
    mockUpload.mockImplementation(
      async () =>
        ({ ref: "uploaded-ref" }) as Awaited<ReturnType<typeof upload>>,
    );
    mockAddPage.mockResolvedValue({} as Awaited<ReturnType<typeof addPage>>);
  });

  describe("slice mode", () => {
    it("uploads one image per slide and adds one page each", async () => {
      await addSlidesToDesign(request("slice"));

      expect(mockUpload).toHaveBeenCalledTimes(COUNT);
      expect(mockAddPage).toHaveBeenCalledTimes(COUNT);
      expect(mockExtractSlide).toHaveBeenCalledTimes(COUNT);
    });

    it("names each upload so the slides are findable in Uploads", async () => {
      await addSlidesToDesign(request("slice"));

      const names = mockUpload.mock.calls.map(
        ([args]) => (args as ImageUploadOptions).name,
      );

      expect(names).toEqual([
        "cascabelito-1",
        "cascabelito-2",
        "cascabelito-3",
      ]);
    });

    it("places every slide flush at the page origin", async () => {
      await addSlidesToDesign(request("slice"));

      for (const element of elements()) {
        expect(element).toMatchObject({
          top: 0,
          left: 0,
          width: PORTRAIT.width,
          height: PORTRAIT.height,
        });
      }
    });

    it("propagates an upload failure instead of leaving a half-built carousel", async () => {
      mockUpload.mockRejectedValueOnce(new Error("upload exploded"));

      await expect(addSlidesToDesign(request("slice"))).rejects.toThrow(
        "upload exploded",
      );
      expect(mockAddPage).not.toHaveBeenCalled();
    });
  });

  describe("linked mode", () => {
    it("reuses an existing Canva asset without uploading or touching pixels", async () => {
      const loadPixels = jest.fn();
      const source = fileSource({
        kind: "selection",
        ref: "already-in-canva" as ImageRef,
        previewUrl: "https://canva.example/tmp.png",
        loadPixels,
      });

      await addSlidesToDesign(request("overflow", source));

      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockRenderComposite).not.toHaveBeenCalled();
      expect(loadPixels).not.toHaveBeenCalled();
      expect(elements().every((e) => e?.ref === "already-in-canva")).toBe(true);
    });

    it("hands a fetchable URL to Canva rather than downloading it first", async () => {
      const loadPixels = jest.fn();
      const source = fileSource({
        kind: "design",
        previewUrl: "https://export.canva.example/design.png",
        mimeType: "image/png",
        loadPixels,
      });

      await addSlidesToDesign(request("overflow", source));

      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockUpload.mock.calls[0]?.[0]).toMatchObject({
        url: "https://export.canva.example/design.png",
        mimeType: "image/png",
      });
      expect(loadPixels).not.toHaveBeenCalled();
      expect(mockRenderComposite).not.toHaveBeenCalled();
    });

    it("flattens a local file to the carousel size before uploading it once", async () => {
      await addSlidesToDesign(request("overflow"));

      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockRenderComposite).toHaveBeenCalledTimes(1);
      expect(mockExtractSlide).not.toHaveBeenCalled();
    });

    it("steps each page one slide further left across the artwork", async () => {
      await addSlidesToDesign(request("overflow"));

      expect(elements().map((e) => e?.left)).toEqual([
        0,
        -PORTRAIT.width,
        -PORTRAIT.width * 2,
      ]);
    });

    it("cover-fits artwork whose aspect does not match the carousel", async () => {
      // Twice as tall as it needs to be: Canva should scale to width and centre
      // the overflow vertically, matching the slicer's own fit.
      const tall = fileSource({
        ref: "tall" as ImageRef,
        width: PORTRAIT.width * COUNT,
        height: PORTRAIT.height * 2,
      });

      await addSlidesToDesign(request("overflow", tall));

      for (const element of elements()) {
        expect(element?.top).toBeCloseTo(-PORTRAIT.height / 2);
        expect(element?.height).toBe(PORTRAIT.height * 2);
        expect(element?.width).toBe(PORTRAIT.width * COUNT);
      }
    });
  });

  describe("a cropped source (a group on the page)", () => {
    // The page exported at 2x, with the artwork occupying part of it.
    const IMAGE = { width: 6480, height: 2700 };
    const cropped = (region: {
      left: number;
      top: number;
      width: number;
      height: number;
    }) =>
      fileSource({
        kind: "group",
        ref: "page-export" as ImageRef,
        previewUrl: "https://export.canva.example/design.png",
        ...IMAGE,
        region,
      });

    it("shifts the placement so the region starts at the first slide", async () => {
      const source = cropped({
        left: 1000,
        top: 500,
        width: WIDE.width,
        height: WIDE.height,
      });

      await addSlidesToDesign(request("overflow", source));

      // Region is already carousel-sized, so it is placed 1:1 and only moved.
      expect(elements().map((e) => e?.left)).toEqual([
        -1000,
        -1000 - PORTRAIT.width,
        -1000 - PORTRAIT.width * 2,
      ]);
      expect(elements()[0]?.top).toBe(-500);
    });

    it("places the whole image, not just the region", async () => {
      const source = cropped({
        left: 1000,
        top: 500,
        width: WIDE.width,
        height: WIDE.height,
      });

      await addSlidesToDesign(request("overflow", source));

      expect(elements()[0]).toMatchObject({
        width: IMAGE.width,
        height: IMAGE.height,
      });
    });

    it("scales the image up when the region is smaller than the carousel", async () => {
      const source = cropped({
        left: 0,
        top: 0,
        width: WIDE.width / 2,
        height: WIDE.height / 2,
      });

      await addSlidesToDesign(request("overflow", source));

      // Region is half the carousel, so everything is drawn at 2x.
      expect(elements()[0]).toMatchObject({
        width: IMAGE.width * 2,
        height: IMAGE.height * 2,
        left: 0,
        top: 0,
      });
    });

    it("behaves exactly as an uncropped source when the region is the whole image", async () => {
      const whole = cropped({ left: 0, top: 0, ...IMAGE });

      await addSlidesToDesign(request("overflow", whole));
      const withRegion = elements().map((e) => e?.left);

      jest.clearAllMocks();
      mockAddPage.mockResolvedValue({} as Awaited<ReturnType<typeof addPage>>);

      const { region: _omitted, ...without } = whole;
      await addSlidesToDesign(request("overflow", without));

      expect(elements().map((e) => e?.left)).toEqual(withRegion);
    });

    it("hands the region to the compositor when slicing", async () => {
      const region = { left: 10, top: 20, width: 300, height: 400 };
      const source = cropped(region);

      await addSlidesToDesign(request("slice", source));

      expect(mockRenderComposite).toHaveBeenCalledWith(
        expect.anything(),
        COUNT,
        PORTRAIT,
        region,
      );
    });
  });

  it("sets each page to the chosen slide dimensions", async () => {
    await addSlidesToDesign(request("slice"));

    for (const [opts] of mockAddPage.mock.calls) {
      expect(opts?.dimensions).toEqual({
        width: PORTRAIT.width,
        height: PORTRAIT.height,
      });
    }
  });

  it("gives every slide alt text naming its position", async () => {
    await addSlidesToDesign(request("slice"));

    const texts = mockAddPage.mock.calls.map(
      ([opts]) =>
        (opts?.elements?.[0] as { altText?: { text: string } } | undefined)
          ?.altText?.text,
    );

    expect(texts).toEqual(["slide 1/3", "slide 2/3", "slide 3/3"]);
  });

  it("reports progress after each page lands", async () => {
    const onProgress = jest.fn();

    await addSlidesToDesign({ ...request("slice"), onProgress });

    expect(onProgress.mock.calls).toEqual([
      [1, COUNT],
      [2, COUNT],
      [3, COUNT],
    ]);
  });
});
