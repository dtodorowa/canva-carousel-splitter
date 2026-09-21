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
import { addPage } from "@canva/design";
import { useCallback, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import * as styles from "styles/components.css";
import { Preview } from "./preview";
import type { SlideFormat } from "./slicer";
import type { SplitMode } from "./split";
import { addSlidesToDesign } from "./split";
import {
  MAX_SLIDES,
  MIN_SLIDES,
  DEFAULT_FORMAT,
  SLIDE_FORMATS,
  clampSlideCount,
  cropWaste,
  exceedsCanvasLimit,
  loadImage,
  suggestSlideCount,
} from "./slicer";

/** Above this, the cover fit is throwing away enough that the user should know. */
const CROP_WARNING_THRESHOLD = 0.12;

type Status =
  | { kind: "idle" }
  | { kind: "working"; done: number; total: number }
  | { kind: "done"; count: number }
  | { kind: "error"; message: string };

export const App = () => {
  const intl = useIntl();
  const isSupported = useFeatureSupport();
  const canAddPages = isSupported(addPage);

  const [file, setFile] = useState<File | undefined>();
  const [image, setImage] = useState<HTMLImageElement | undefined>();
  const [formatId, setFormatId] = useState<string>(DEFAULT_FORMAT.id);
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<SplitMode>("slice");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const format = useMemo<SlideFormat>(
    () => SLIDE_FORMATS.find((f) => f.id === formatId) ?? DEFAULT_FORMAT,
    [formatId],
  );

  const formatLabels = useMemo(
    () => ({
      portrait: intl.formatMessage({
        defaultMessage: "Portrait 4:5 — 1080×1350",
        description: "Instagram portrait slide size option",
      }),
      square: intl.formatMessage({
        defaultMessage: "Square 1:1 — 1080×1080",
        description: "Instagram square slide size option",
      }),
      story: intl.formatMessage({
        defaultMessage: "Story 9:16 — 1080×1920",
        description: "Instagram story slide size option",
      }),
    }),
    [intl],
  );

  const onSelectFile = useCallback(
    async (files: File[]) => {
      const picked = files[0];

      if (!picked) {
        return;
      }

      setStatus({ kind: "idle" });

      try {
        const loaded = await loadImage(picked);
        setFile(picked);
        setImage(loaded);
        setCount(suggestSlideCount(loaded, format));
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : intl.formatMessage({
                  defaultMessage: "That file could not be read as an image.",
                  description: "Error shown when the chosen file cannot load",
                }),
        });
      }
    },
    [format, intl],
  );

  const clearFile = useCallback(() => {
    setFile(undefined);
    setImage(undefined);
    setStatus({ kind: "idle" });
  }, []);

  const waste = useMemo(
    () => (image ? cropWaste(image, count, format) : undefined),
    [image, count, format],
  );

  const tooLarge = useMemo(
    () => exceedsCanvasLimit(count, format),
    [count, format],
  );

  const split = useCallback(async () => {
    if (!image || !canAddPages) {
      return;
    }

    setStatus({ kind: "working", done: 0, total: count });

    try {
      await addSlidesToDesign({
        image,
        count,
        format,
        mode,
        name: file?.name.replace(/\.[^.]+$/, "") || "carousel",
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
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : intl.formatMessage({
                defaultMessage: "Something went wrong while adding the slides.",
                description: "Generic failure message",
              }),
      });
    }
  }, [image, canAddPages, count, format, mode, file, intl]);

  const busy = status.kind === "working";

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
                "Drop in one wide image and it becomes a run of slides, cut so the artwork carries across the swipe.",
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

        {file ? (
          <FileInputItem
            label={file.name}
            onDeleteClick={clearFile}
            disabled={busy}
          />
        ) : (
          <FileInput
            accept={["image/png", "image/jpeg", "image/webp"]}
            multiple={false}
            stretchButton
            onDropAcceptedFiles={onSelectFile}
          />
        )}

        {image && (
          <Rows spacing="2u">
            <Preview image={image} count={count} format={format} />

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
                    label: formatLabels[f.id as keyof typeof formatLabels],
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
                      "About {percent}% of your image falls outside {count} slides at this size. Change the slide count, or resize the source to {width}×{height}.",
                    description:
                      "Warning that the source image does not match the chosen slide layout",
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
                    "That many slides at this size is too big for the browser to render in one piece. Use fewer slides.",
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
