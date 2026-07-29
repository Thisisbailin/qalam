import type { PdfHighlightRect } from "../types";

export type ClientRectLike = Pick<DOMRect, "left" | "top" | "width" | "height">;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

export const normalizePdfSelectionRects = (
  pageRect: ClientRectLike,
  selectionRects: Iterable<ClientRectLike>
): PdfHighlightRect[] => {
  if (pageRect.width <= 0 || pageRect.height <= 0) return [];
  return Array.from(selectionRects)
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => {
      const x = clamp((rect.left - pageRect.left) / pageRect.width);
      const y = clamp((rect.top - pageRect.top) / pageRect.height);
      const width = clamp(rect.width / pageRect.width);
      const height = clamp(rect.height / pageRect.height);
      return {
        x,
        y,
        width: Math.min(width, 1 - x),
        height: Math.min(height, 1 - y),
      };
    })
    .filter((rect) => rect.width > 0.001 && rect.height > 0.001);
};

export const getPdfHighlightBounds = (rects: PdfHighlightRect[]): PdfHighlightRect => {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
};
