import { useFeatureSupport } from "@canva/app-hooks";
import {
  Alert,
  Button,
  FileInput,
  FileInputItem,
  FormField,
  ProgressBar,
  Rows,
  SegmentedControl,
  Select,
  Slider,
  Text,
  Title,
} from "@canva/app-ui-kit";
import { addPage, getCurrentPageContext, requestExport } from "@canva/design";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import * as styles from "styles/components.css";
import { Preview } from "./preview";
import type { SlideFormat } from "./slicer";
import {
  DEFAULT_FORMAT,
  MAX_SLIDES,
  MIN_SLIDES,
  SLIDE_FORMATS,
  clampSlideCount,
  compositeSize,
  cropWaste,
  exceedsCanvasLimit,
  planCarouselPage,
  suggestSlideCount,
} from "./slicer";
import type { CarouselSource, SourceKind } from "./sources";
import {
  ExportAbortedError,
  NoSelectionError,
  sourceFromDesign,
  sourceFromFile,
  sourceFromSelection,
} from "./sources";
import type { SplitMode } from "./split";
import { addSlidesToDesign } from "./split";

/** Above this, the cover fit is throwing away enough that the user should know. */
const CROP_WARNING_THRESHOLD = 0.12;

type Status =
  | { kind: "idle" }
  | { kind: "working"; done: number; total: number }
  | { kind: "done"; count: number }
  | { kind: "canvasAdded"; width: number; height: number }
  | { kind: "error"; message: string };

export const App = () => {
  const intl = useIntl();
  const isSupported = useFeatureSupport();
  const canAddPages = isSupported(addPage);
  const canExport = isSupported(requestExport);

  const [source, setSource] = useState<CarouselSource | undefined>();
  const [loadingSource, setLoadingSource] = useState<SourceKind | undefined>();
  const [formatId, setFormatId] = useState<string>(DEFAULT_FORMAT.id);
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<SplitMode>("slice");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [addingCanvas, setAddingCanvas] = useState(false);
  const [currentPage, setCurrentPage] = useState<
    { width: number; height: number } | undefined
  >();

  const format = useMemo<SlideFormat>(
    () => SLIDE_FORMATS.find((f) => f.id === formatId) ?? DEFAULT_FORMAT,
    [formatId],
  );

  // Open on a wide page and the slide count should already be right, so read
  // the page once on mount. Later changes are the user's, so this never reruns.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const context = await getCurrentPageContext();

        if (cancelled || !context?.dimensions) {
          return;
        }

        setCurrentPage(context.dimensions);
        setCount(suggestSlideCount(context.dimensions, DEFAULT_FORMAT));
      } catch {
        // A starting guess is a nicety; never let it take the panel down.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const target = useMemo(() => compositeSize(count, format), [count, format]);
  const plan = useMemo(() => planCarouselPage(count, format), [count, format]);

  const describeError = useCallback(
    (error: unknown): string => {
      if (error instanceof NoSelectionError) {
        return intl.formatMessage({
          defaultMessage:
            "Select an image on the canvas first, then try again.",
          description: "Shown when nothing is selected",
        });
      }

      if (error instanceof ExportAbortedError) {
        return intl.formatMessage({
          defaultMessage: "Export cancelled.",
          description: "Shown when the user dismisses the export dialog",
        });
      }

      if (error instanceof Error) {
        return error.message;
      }

      return intl.formatMessage({
        defaultMessage: "Something went wrong.",
        description: "Generic failure message",
      });
    },
    [intl],
  );

  const adopt = useCallback(
    async (kind: SourceKind, load: () => Promise<CarouselSource>) => {
      setLoadingSource(kind);
      setStatus({ kind: "idle" });

      try {
        const next = await load();
        setSource(next);
        setCount(suggestSlideCount(next, format));
      } catch (error) {
        setStatus({ kind: "error", message: describeError(error) });
      } finally {
        setLoadingSource(undefined);
      }
    },
    [format, describeError],
  );

  const clearSource = useCallback(() => {
    setSource(undefined);
    setStatus({ kind: "idle" });
  }, []);

  /** Add the blank wide page the whole carousel gets drawn on. */
  const addCanvas = useCallback(async () => {
    setAddingCanvas(true);
    setStatus({ kind: "idle" });

    try {
      await addPage({
        dimensions: { width: plan.width, height: plan.height },
        title: intl.formatMessage(
          {
            defaultMessage: "Carousel — {count} slides",
            description: "Title given to the blank carousel page",
          },
          { count },
        ),
      });
      setStatus({
        kind: "canvasAdded",
        width: plan.width,
        height: plan.height,
      });
    } catch (error) {
      setStatus({ kind: "error", message: describeError(error) });
    } finally {
      setAddingCanvas(false);
    }
  }, [plan, count, intl, describeError]);

  const waste = useMemo(
    () => (source ? cropWaste(source, count, format) : undefined),
    [source, count, format],
  );

  // Linked mode lets Canva do the scaling, so the browser canvas cap only
  // applies when we have to cut the artwork up ourselves.
  const tooLarge = useMemo(
    () => mode === "slice" && exceedsCanvasLimit(count, format),
    [mode, count, format],
  );

  const split = useCallback(async () => {
    if (!source || !canAddPages) {
      return;
    }

    setStatus({ kind: "working", done: 0, total: count });

    try {
      await addSlidesToDesign({
        source,
        count,
        format,
        mode,
        name: source.label.replace(/\.[^.]+$/, "") || "carousel",
        altTextFor: (index, total) =>
          intl.formatMessage(
            {
              defaultMessage: "Carousel slide {number} of {total}",
              description: "Alt text for a generated carousel slide",
            },
            { number: index + 1, total },
          ),
        onProgress: (done, total) =>
          setStatus({ kind: "working", done, total }),
      });

      setStatus({ kind: "done", count });
    } catch (error) {
      setStatus({ kind: "error", message: describeError(error) });
    }
  }, [source, canAddPages, count, format, mode, intl, describeError]);

  const busy = status.kind === "working";
  const picking = loadingSource != null;

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Rows spacing="1u">
          <Title size="small">
            {intl.formatMessage({
              defaultMessage: "Carousel Splitter",
              description: "App title",
            })}
          </Title>
          <Text size="small" tone="tertiary">
            {intl.formatMessage({
              defaultMessage:
                "Take one wide piece of artwork and cut it into slides, so it carries across the swipe.",
              description: "One-line explanation of what the app does",
            })}
          </Text>
        </Rows>

        {!canAddPages && (
          <Alert tone="warn">
            {intl.formatMessage({
              defaultMessage:
                "This design type can't have pages added to it. Open a presentation or an Instagram post design and try again.",
              description:
                "Shown when the current design does not support addPage",
            })}
          </Alert>
        )}

        <FormField
          label={intl.formatMessage({
            defaultMessage: "Slide size",
            description: "Label for the slide dimensions picker",
          })}
          value={formatId}
          control={(props) => (
            <Select
              {...props}
              stretch
              disabled={busy}
              options={SLIDE_FORMATS.map((f) => ({
                value: f.id,
                label: formatLabel(f, intl),
              }))}
              onChange={(value) => setFormatId(value)}
            />
          )}
        />

        <FormField
          label={intl.formatMessage(
            {
              defaultMessage: "Slides: {count}",
              description: "Label for the slide count slider",
            },
            { count },
          )}
          value={count}
          control={(props) => (
            <Slider
              {...props}
              min={MIN_SLIDES}
              max={MAX_SLIDES}
              step={1}
              disabled={busy}
              onChange={(value) => setCount(clampSlideCount(value))}
            />
          )}
        />

        <Text size="small" tone="tertiary">
          {currentPage
            ? intl.formatMessage(
                {
                  defaultMessage:
                    "This page is {pageWidth} × {pageHeight} px, which fits {count} slides of {width} × {height}.",
                  description:
                    "Relates the current page size to the chosen slide count",
                },
                {
                  pageWidth: currentPage.width,
                  pageHeight: currentPage.height,
                  count,
                  width: format.width,
                  height: format.height,
                },
              )
            : intl.formatMessage(
                {
                  defaultMessage:
                    "{count} slides side by side is {width} × {height} px.",
                  description: "The full size of the artwork for this carousel",
                },
                { count, width: target.width, height: target.height },
              )}
        </Text>

        {source ? (
          <FileInputItem
            label={sourceLabel(source, intl)}
            onDeleteClick={clearSource}
            disabled={busy}
          />
        ) : (
          <Rows spacing="2u">
            <Rows spacing="1u">
              <Button
                variant="primary"
                stretch
                loading={addingCanvas}
                disabled={addingCanvas || !canAddPages}
                onClick={addCanvas}
              >
                {intl.formatMessage(
                  {
                    defaultMessage: "Add a blank {width} × {height} page",
                    description:
                      "Button that adds a correctly sized page to draw on",
                  },
                  { width: plan.width, height: plan.height },
                )}
              </Button>
              {plan.scale < 1 && (
                <Text size="small" tone="tertiary">
                  {intl.formatMessage(
                    {
                      defaultMessage:
                        "Canva caps pages at 8000 px wide, so this one is {percent}% scale. Splitting still produces {width} px slides, scaled back up.",
                      description:
                        "Explains why the page is smaller than the full carousel",
                    },
                    {
                      percent: Math.round(plan.scale * 100),
                      width: format.width,
                    },
                  )}
                </Text>
              )}
            </Rows>

            <Rows spacing="1u">
              <Text size="small" tone="tertiary">
                {intl.formatMessage({
                  defaultMessage: "Or split artwork you already have:",
                  description: "Heading above the artwork source options",
                })}
              </Text>
              <FileInput
                accept={["image/png", "image/jpeg", "image/webp"]}
                multiple={false}
                stretchButton
                disabled={picking}
                onDropAcceptedFiles={(files) => {
                  const picked = files[0];

                  if (picked) {
                    void adopt("upload", () => sourceFromFile(picked));
                  }
                }}
              />
              <Button
                variant="secondary"
                stretch
                disabled={picking || !canExport}
                loading={loadingSource === "design"}
                onClick={() => void adopt("design", sourceFromDesign)}
              >
                {intl.formatMessage({
                  defaultMessage: "Use current design",
                  description:
                    "Button that exports the open design as the source",
                })}
              </Button>
              <Button
                variant="secondary"
                stretch
                disabled={picking}
                loading={loadingSource === "selection"}
                onClick={() => void adopt("selection", sourceFromSelection)}
              >
                {intl.formatMessage({
                  defaultMessage: "Use selected image",
                  description:
                    "Button that uses the image selected on the canvas as the source",
                })}
              </Button>
            </Rows>
          </Rows>
        )}

        {status.kind === "canvasAdded" && (
          <Alert tone="positive">
            {intl.formatMessage(
              {
                defaultMessage:
                  "Added a {width} × {height} page at the end of your design. Draw the whole carousel there, then come back and choose Use current design.",
                description: "Success message after adding the blank page",
              },
              { width: status.width, height: status.height },
            )}
          </Alert>
        )}

        {status.kind === "error" && !source && (
          <Alert tone="critical">{status.message}</Alert>
        )}

        {source && (
          <Rows spacing="2u">
            <Preview url={source.previewUrl} count={count} format={format} />

            {source.pageCount != null && source.pageCount > 1 && (
              <Alert tone={source.pageAmbiguous ? "warn" : "info"}>
                {source.pageAmbiguous
                  ? intl.formatMessage(
                      {
                        defaultMessage:
                          "Page {page} of {pages} was taken, but another page is the same shape, so check it is the one you meant.",
                        description:
                          "Shown when more than one page matched the current page's shape",
                      },
                      {
                        pages: source.pageCount,
                        page: (source.pageIndex ?? 0) + 1,
                      },
                    )
                  : intl.formatMessage(
                      {
                        defaultMessage:
                          "Splitting page {page} of {pages}, the one you have open.",
                        description:
                          "Shown when the exported design had more than one page",
                      },
                      {
                        pages: source.pageCount,
                        page: (source.pageIndex ?? 0) + 1,
                      },
                    )}
              </Alert>
            )}

            <FormField
              label={intl.formatMessage({
                defaultMessage: "After splitting",
                description: "Label for the split mode picker",
              })}
              value={mode}
              control={(props) => (
                <SegmentedControl
                  {...props}
                  disabled={busy}
                  options={[
                    {
                      value: "slice",
                      label: intl.formatMessage({
                        defaultMessage: "Separate",
                        description:
                          "Split mode where each slide is its own image",
                      }),
                    },
                    {
                      value: "overflow",
                      label: intl.formatMessage({
                        defaultMessage: "Linked",
                        description:
                          "Split mode where all slides share one image",
                      }),
                    },
                  ]}
                  onChange={(value) => setMode(value as SplitMode)}
                />
              )}
            />

            <Text size="small" tone="tertiary">
              {mode === "slice"
                ? intl.formatMessage({
                    defaultMessage:
                      "Each slide becomes its own image in your Uploads, ready to edit one at a time.",
                    description: "Explanation of the separate split mode",
                  })
                : intl.formatMessage({
                    defaultMessage:
                      "All slides share one image, each page showing a different part of it. Move the artwork on any page and the rest still line up.",
                    description: "Explanation of the linked split mode",
                  })}
            </Text>

            {waste && waste.fraction > CROP_WARNING_THRESHOLD && (
              <Alert tone="warn">
                {intl.formatMessage(
                  {
                    defaultMessage:
                      "About {percent}% of the artwork falls outside {count} slides at this size. Change the slide count, or resize the source to {width}×{height}.",
                    description:
                      "Warning that the source does not match the chosen slide layout",
                  },
                  {
                    percent: Math.round(waste.fraction * 100),
                    count,
                    width: waste.target.width,
                    height: waste.target.height,
                  },
                )}
              </Alert>
            )}

            {tooLarge && (
              <Alert tone="critical">
                {intl.formatMessage({
                  defaultMessage:
                    "That many slides at this size is too big for the browser to cut up. Use fewer slides, or switch to Linked.",
                  description:
                    "Warning that the composite exceeds canvas limits",
                })}
              </Alert>
            )}

            {busy && (
              <Rows spacing="0.5u">
                <Text size="small" tone="tertiary">
                  {intl.formatMessage(
                    {
                      defaultMessage: "Adding slide {done} of {total}…",
                      description:
                        "Progress label while slides are being added",
                    },
                    {
                      done: Math.min(status.done + 1, status.total),
                      total: status.total,
                    },
                  )}
                </Text>
                <ProgressBar
                  value={Math.round((status.done / status.total) * 100)}
                  ariaLabel={intl.formatMessage({
                    defaultMessage: "Adding slides to your design",
                    description: "Accessible name for the progress bar",
                  })}
                />
              </Rows>
            )}

            {status.kind === "done" && (
              <Alert tone="positive">
                {intl.formatMessage(
                  {
                    defaultMessage:
                      "Added {count} slides to the end of your design.",
                    description: "Success message",
                  },
                  { count: status.count },
                )}
              </Alert>
            )}

            {status.kind === "error" && (
              <Alert tone="critical">{status.message}</Alert>
            )}

            <Button
              variant="primary"
              stretch
              loading={busy}
              disabled={busy || !canAddPages || tooLarge}
              onClick={split}
            >
              {intl.formatMessage(
                {
                  defaultMessage: "Add {count} slides to design",
                  description: "Primary action button",
                },
                { count },
              )}
            </Button>
          </Rows>
        )}
      </Rows>
    </div>
  );
};

/** Falls back to a translated name when the source has no natural title. */
function sourceLabel(
  source: CarouselSource,
  intl: ReturnType<typeof useIntl>,
): string {
  if (source.label) {
    return source.label;
  }

  return source.kind === "selection"
    ? intl.formatMessage({
        defaultMessage: "Selected image",
        description: "Name for artwork taken from the canvas selection",
      })
    : intl.formatMessage({
        defaultMessage: "Current design",
        description: "Name for artwork taken from the open design",
      });
}

function formatLabel(
  format: SlideFormat,
  intl: ReturnType<typeof useIntl>,
): string {
  const dimensions = `${format.width}×${format.height}`;

  switch (format.id) {
    case "square":
      return intl.formatMessage(
        {
          defaultMessage: "Square 1:1 — {dimensions}",
          description: "Instagram square slide size option",
        },
        { dimensions },
      );
    case "story":
      return intl.formatMessage(
        {
          defaultMessage: "Story 9:16 — {dimensions}",
          description: "Instagram story slide size option",
        },
        { dimensions },
      );
    default:
      return intl.formatMessage(
        {
          defaultMessage: "Portrait 4:5 — {dimensions}",
          description: "Instagram portrait slide size option",
        },
        { dimensions },
      );
  }
}
