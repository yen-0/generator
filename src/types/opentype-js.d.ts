declare module "opentype.js" {
  export type BoundingBox = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };

  export class Path {
    getBoundingBox(): BoundingBox;
    toPathData(decimalPlaces?: number): string;
  }

  export class Font {
    getPath(text: string, x: number, y: number, fontSize: number): Path;
  }

  export function parse(buffer: ArrayBuffer): Font;

  const opentype: {
    parse: typeof parse;
    Font: typeof Font;
    Path: typeof Path;
  };

  export default opentype;
}
