import { useFeatureSupport } from "@canva/app-hooks";
import { addPage, getCurrentPageContext } from "@canva/design";
import type { Feature } from "@canva/platform";
import { waitFor } from "@testing-library/react";
import { App } from "../app";
import { renderInTestProvider } from "../../../utils/test_render";

jest.mock("@canva/app-hooks");

const mockUseFeatureSupport = jest.mocked(useFeatureSupport);
const mockPageContext = jest.mocked(getCurrentPageContext);

const setSupported = (supported: boolean) => {
  mockUseFeatureSupport.mockReturnValue(
    jest.fn((fn: Feature) => (fn === addPage ? supported : false)),
  );
};

describe("App", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setSupported(true);
    mockPageContext.mockResolvedValue({ dimensions: undefined });
  });

  it("warns when the open design cannot take new pages", () => {
    setSupported(false);

    const { getByText } = renderInTestProvider(<App />);

    expect(getByText(/can't have pages added to it/i)).toBeTruthy();
  });

  it("stays quiet about page support when the design does allow it", () => {
    const { queryByText } = renderInTestProvider(<App />);

    expect(queryByText(/can't have pages added to it/i)).toBeNull();
  });

  it("offers no split button until artwork has been chosen", () => {
    const { queryByRole } = renderInTestProvider(<App />);

    expect(
      queryByRole("button", { name: /add .* slides to design/i }),
    ).toBeNull();
  });

  describe("starting slide count", () => {
    it("reads the count off a wide page as soon as the panel opens", async () => {
      mockPageContext.mockResolvedValue({
        dimensions: { width: 3240, height: 1350 },
      });

      const { findByText } = renderInTestProvider(<App />);

      expect(await findByText(/Slides: 3/)).toBeTruthy();
    });

    it("scales the guess with the page width", async () => {
      mockPageContext.mockResolvedValue({
        dimensions: { width: 5400, height: 1350 },
      });

      const { findByText } = renderInTestProvider(<App />);

      expect(await findByText(/Slides: 5/)).toBeTruthy();
    });

    it("relates the page size to the slides it fits", async () => {
      mockPageContext.mockResolvedValue({
        dimensions: { width: 4320, height: 1350 },
      });

      const { findByText } = renderInTestProvider(<App />);

      expect(await findByText(/This page is 4320 × 1350 px/)).toBeTruthy();
    });

    it("keeps the default when the design type has no fixed page size", async () => {
      const { getByText } = renderInTestProvider(<App />);

      await waitFor(() => expect(mockPageContext).toHaveBeenCalled());
      expect(getByText(/Slides: 3/)).toBeTruthy();
    });

    it("survives the page context being unavailable", async () => {
      mockPageContext.mockRejectedValue(new Error("not supported here"));

      const { getByText } = renderInTestProvider(<App />);

      await waitFor(() => expect(mockPageContext).toHaveBeenCalled());
      expect(getByText(/Slides: 3/)).toBeTruthy();
    });
  });
});
