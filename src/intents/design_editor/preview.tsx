import { useEffect, useRef } from "react";
import type { SlideFormat } from "./slicer";
import { renderComposite } from "./slicer";
import * as styles from "./preview.css";

const PREVIEW_WIDTH = 288;

type PreviewProps = {
  image: HTMLImageElement;
  count: number;
  format: SlideFormat;
};

/**
 * The composite as it will be cut, with the seams drawn on top. Rendered at
 * panel scale rather than full size so dragging the slide-count slider stays
 * responsive on a 10-slide carousel.
 */
export const Preview = ({ image, count, format }: PreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const scale = PREVIEW_WIDTH / (format.width * count);
    const scaled: SlideFormat = {
      id: format.id,
      width: Math.max(1, Math.round(format.width * scale)),
      height: Math.max(1, Math.round(format.height * scale)),
    };

    const composite = renderComposite(image, count, scaled);
    canvas.width = composite.width;
    canvas.height = composite.height;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.drawImage(composite, 0, 0);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);

    for (let i = 1; i < count; i++) {
      const x = i * scaled.width + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, composite.height);
      ctx.stroke();
    }
  }, [image, count, format]);

  return <canvas ref={canvasRef} className={styles.previewCanvas} />;
};
