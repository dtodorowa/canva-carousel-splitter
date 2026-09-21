import type { Region } from "./groups";
import type { SlideFormat, Size } from "./slicer";
import { compositeSize, fitCover } from "./slicer";
import * as styles from "./preview.css";

type PreviewProps = {
  url: string;
  /** Size of the whole image at `url`. */
  image: Size;
  /** Part of it that is the artwork. Absent means all of it. */
  region?: Region;
  count: number;
  format: SlideFormat;
};

/**
 * The artwork as it will be cut, with the seams drawn on.
 *
 * Laid out in percentages rather than drawn, so it never reads a pixel — an
 * exported design may not be CORS-readable, and a region has to be croppable
 * either way. Two nested boxes: the outer one is the cover fit of the region
 * into the carousel, the inner one scales the whole image so that the region
 * fills it.
 */
export const Preview = ({
  url,
  image,
  region,
  count,
  format,
}: PreviewProps) => {
  const target = compositeSize(count, format);
  const crop = region ?? { left: 0, top: 0, ...image };
  const fit = fitCover(crop, target);
  const percent = (value: number) => `${value * 100}%`;

  const seams = Array.from({ length: count - 1 }, (_, i) => (i + 1) / count);

  return (
    <div
      className={styles.previewFrame}
      style={{ aspectRatio: `${target.width} / ${target.height}` }}
    >
      <div
        className={styles.previewCrop}
        style={{
          left: percent(fit.offsetX / target.width),
          top: percent(fit.offsetY / target.height),
          width: percent(fit.drawWidth / target.width),
          height: percent(fit.drawHeight / target.height),
        }}
      >
        <div
          className={styles.previewImage}
          style={{
            backgroundImage: `url(${JSON.stringify(url)})`,
            left: percent(-crop.left / crop.width),
            top: percent(-crop.top / crop.height),
            width: percent(image.width / crop.width),
            height: percent(image.height / crop.height),
          }}
        />
      </div>
      {seams.map((fraction) => (
        <span
          key={fraction}
          className={styles.previewSeam}
          style={{ left: percent(fraction) }}
        />
      ))}
    </div>
  );
};
