import { useFeatureSupport } from "@canva/app-hooks";
import { addPage } from "@canva/design";
import type { Feature } from "@canva/platform";
import { App } from "../app";
import { renderInTestProvider } from "../../../utils/test_render";

jest.mock("@canva/app-hooks");

const mockUseFeatureSupport = jest.mocked(useFeatureSupport);

const setSupported = (supported: boolean) => {
  mockUseFeatureSupport.mockReturnValue(
    jest.fn((fn: Feature) => (fn === addPage ? supported : false)),
  );
};

describe("App", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setSupported(true);
  });

  it("starts with nothing but the file picker, since there is nothing to configure yet", () => {
    const { queryByRole } = renderInTestProvider(<App />);

    expect(
      queryByRole("button", { name: /add .* slides to design/i }),
    ).toBeNull();
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
});
