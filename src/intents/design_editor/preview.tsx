import type { SlideFormat } from "./slicer";
import * as styles from "./preview.css";

type PreviewProps = {
  url: string;
  count: number;
  format: SlideFormat;
};

/**
 * The artwork as it will be cut, with the seams drawn on.
 *
 * `background-size: cover` on a box of the carousel's aspect ratio performs
 * exactly the fit `fitCover` computes, so this stays truthful without reading a
 * single pixel — which matters because an exported design may not be
 * CORS-readable. It is a backdrop rather than an image element because the
 * artwork here is decorative; the real content is the seam positions.
 */
export const Preview = ({ url, count, format }: PreviewProps) => {
  const seams = Array.from({ length: count - 1 }, (_, i) => (i + 1) / count);

  return (
    <div
      className={styles.previewFrame}
      style={{
        aspectRatio: `${format.width * count} / ${format.height}`,
        backgroundImage: `url(${JSON.stringify(url)})`,
      }}
    >
      {seams.map((fraction) => (
        <span
          key={fraction}
          className={styles.previewSeam}
          style={{ left: `${fraction * 100}%` }}
        />
      ))}
    </div>
  );
};
