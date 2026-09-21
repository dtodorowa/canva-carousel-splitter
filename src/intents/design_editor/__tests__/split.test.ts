import type { ImageUploadOptions } from "@canva/asset";
import { upload } from "@canva/asset";
import { addPage } from "@canva/design";
import { PORTRAIT } from "../slicer";
import { encodeCanvas, extractSlide, renderComposite } from "../slicer";
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
const COMPOSITE = {
  width: PORTRAIT.width * COUNT,
  height: PORTRAIT.height,
} as HTMLCanvasElement;

const request = (mode: "slice" | "overflow") => ({
  image: {} as HTMLImageElement,
  count: COUNT,
  format: PORTRAIT,
  mode,
  name: "cascabelito",
  altTextFor: (index: number, total: number) => `slide ${index + 1}/${total}`,
});

describe("addSlidesToDesign", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRenderComposite.mockReturnValue(COMPOSITE);
    mockExtractSlide.mockReturnValue({} as HTMLCanvasElement);
    mockEncodeCanvas.mockReturnValue({
      dataUrl: "data:image/png;base64,AAA",
      thumbnailUrl: "data:image/jpeg;base64,BBB",
      mimeType: "image/png",
      width: PORTRAIT.width,
      height: PORTRAIT.height,
    });
    mockUpload.mockImplementation(
      async () => ({ ref: "img-ref" }) as Awaited<ReturnType<typeof upload>>,
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

      for (const [opts] of mockAddPage.mock.calls) {
        const element = opts?.elements?.[0];
        expect(element).toMatchObject({
          type: "image",
          top: 0,
          left: 0,
          width: PORTRAIT.width,
          height: PORTRAIT.height,
        });
      }
    });
  });

  describe("overflow mode", () => {
    it("uploads the composite once and reuses the ref on every page", async () => {
      await addSlidesToDesign(request("overflow"));

      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockAddPage).toHaveBeenCalledTimes(COUNT);
      expect(mockExtractSlide).not.toHaveBeenCalled();
    });

    it("steps each page one slide further left across the composite", async () => {
      await addSlidesToDesign(request("overflow"));

      const lefts = mockAddPage.mock.calls.map(
        ([opts]) => (opts?.elements?.[0] as { left: number } | undefined)?.left,
      );

      expect(lefts).toEqual([0, -PORTRAIT.width, -PORTRAIT.width * 2]);
    });

    it("sizes the element to the whole composite, not the page", async () => {
      await addSlidesToDesign(request("overflow"));

      const [opts] = mockAddPage.mock.calls[0] ?? [];
      expect(opts?.elements?.[0]).toMatchObject({
        width: COMPOSITE.width,
        height: COMPOSITE.height,
      });
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

  it("propagates an upload failure instead of leaving a half-built carousel", async () => {
    mockUpload.mockRejectedValueOnce(new Error("upload exploded"));

    await expect(addSlidesToDesign(request("slice"))).rejects.toThrow(
      "upload exploded",
    );
    expect(mockAddPage).not.toHaveBeenCalled();
  });
});
