// Pixi v8's Text and TextStyle: canvas text with Pixi's metrics (line height from the font's actual
// ascent + descent of '|ÉqÅM', letter spacing added per grapheme, padding around), so a glyph placed
// by Folia's layout lands where it does under Pixi. Rasterised once per look and scale step (render.ts).
import { Bounds, Matrix, Point } from './math';
import { Container, type ContainerOptions, type DestroyOptions } from './container';
import { Color, type ColorSource } from './color';
import { FillGradient } from './graphics';

export type TextStyleFontWeight =
  | 'normal'
  | 'bold'
  | 'bolder'
  | 'lighter'
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900';

export interface TextDropShadow {
  alpha: number;
  angle: number;
  blur: number;
  color: ColorSource;
  distance: number;
}

export interface TextStrokeStyle {
  color?: ColorSource;
  width?: number;
  join?: CanvasLineJoin;
  alpha?: number;
}

export interface TextStyleOptions {
  align?: 'left' | 'center' | 'right' | 'justify';
  breakWords?: boolean;
  dropShadow?: boolean | Partial<TextDropShadow> | null;
  fill?: ColorSource | FillGradient | { color?: ColorSource; alpha?: number } | null;
  fontFamily?: string | string[];
  fontSize?: number | string;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  fontVariant?: 'normal' | 'small-caps';
  fontWeight?: TextStyleFontWeight | string;
  leading?: number;
  letterSpacing?: number;
  lineHeight?: number;
  padding?: number;
  stroke?: ColorSource | TextStrokeStyle | null;
  textBaseline?: CanvasTextBaseline;
  trim?: boolean;
  whiteSpace?: 'normal' | 'pre' | 'pre-line';
  wordWrap?: boolean;
  wordWrapWidth?: number;
}

const DEFAULT_SHADOW: TextDropShadow = { alpha: 1, angle: Math.PI / 6, blur: 0, color: 'black', distance: 5 };

let styleUid = 1;

export class TextStyle {
  align: 'left' | 'center' | 'right' | 'justify' = 'left';
  breakWords = false;
  dropShadow: TextDropShadow | null = null;
  fill: TextStyleOptions['fill'] = 'black';
  fontFamily: string | string[] = 'Arial';
  fontSize = 26;
  fontStyle: 'normal' | 'italic' | 'oblique' = 'normal';
  fontVariant: 'normal' | 'small-caps' = 'normal';
  fontWeight: string = 'normal';
  leading = 0;
  letterSpacing = 0;
  lineHeight = 0;
  padding = 0;
  stroke: TextStrokeStyle | null = null;
  textBaseline: CanvasTextBaseline = 'alphabetic';
  trim = false;
  whiteSpace: 'normal' | 'pre' | 'pre-line' = 'pre';
  wordWrap = false;
  wordWrapWidth = 100;
  /** Bumped when a field is changed through `update()`; caches key on (uid, version). */
  readonly uid = styleUid++;
  version = 0;
  constructor(options: TextStyleOptions | TextStyle = {}) {
    this.assign(options instanceof TextStyle ? options.toOptions() : options);
  }
  private assign(o: TextStyleOptions) {
    if (o.align !== undefined) this.align = o.align;
    if (o.breakWords !== undefined) this.breakWords = o.breakWords;
    if (o.dropShadow !== undefined)
      this.dropShadow = o.dropShadow ? { ...DEFAULT_SHADOW, ...(o.dropShadow === true ? {} : o.dropShadow) } : null;
    if (o.fill !== undefined) this.fill = o.fill;
    if (o.fontFamily !== undefined) this.fontFamily = o.fontFamily;
    if (o.fontSize !== undefined) this.fontSize = typeof o.fontSize === 'string' ? parseFloat(o.fontSize) : o.fontSize;
    if (o.fontStyle !== undefined) this.fontStyle = o.fontStyle;
    if (o.fontVariant !== undefined) this.fontVariant = o.fontVariant;
    if (o.fontWeight !== undefined) this.fontWeight = String(o.fontWeight);
    if (o.leading !== undefined) this.leading = o.leading;
    if (o.letterSpacing !== undefined) this.letterSpacing = o.letterSpacing;
    if (o.lineHeight !== undefined) this.lineHeight = o.lineHeight;
    if (o.padding !== undefined) this.padding = o.padding;
    if (o.stroke !== undefined)
      this.stroke =
        o.stroke === null
          ? null
          : Color.isColorLike(o.stroke)
            ? { color: o.stroke as ColorSource, width: 1 }
            : { ...(o.stroke as TextStrokeStyle) };
    if (o.textBaseline !== undefined) this.textBaseline = o.textBaseline;
    if (o.trim !== undefined) this.trim = o.trim;
    if (o.whiteSpace !== undefined) this.whiteSpace = o.whiteSpace;
    if (o.wordWrap !== undefined) this.wordWrap = o.wordWrap;
    if (o.wordWrapWidth !== undefined) this.wordWrapWidth = o.wordWrapWidth;
  }
  toOptions(): TextStyleOptions {
    return {
      align: this.align,
      breakWords: this.breakWords,
      dropShadow: this.dropShadow,
      fill: this.fill,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontStyle: this.fontStyle,
      fontVariant: this.fontVariant,
      fontWeight: this.fontWeight,
      leading: this.leading,
      letterSpacing: this.letterSpacing,
      lineHeight: this.lineHeight,
      padding: this.padding,
      stroke: this.stroke,
      textBaseline: this.textBaseline,
      trim: this.trim,
      whiteSpace: this.whiteSpace,
      wordWrap: this.wordWrap,
      wordWrapWidth: this.wordWrapWidth,
    };
  }
  clone() {
    return new TextStyle(this);
  }
  update() {
    this.version += 1;
  }
  get strokeWidth() {
    return this.stroke ? (this.stroke.width ?? 1) : 0;
  }
  /** The CSS font shorthand. */
  get font() {
    const fam = (Array.isArray(this.fontFamily) ? this.fontFamily : [this.fontFamily])
      .map((f) =>
        /^[\w-]+$/.test(f) && !/^\d/.test(f) ? f : f.includes(',') ? f : `"${f.replace(/^["']|["']$/g, '')}"`,
      )
      .join(',');
    return `${this.fontStyle} ${this.fontVariant} ${this.fontWeight} ${this.fontSize}px ${fam}`;
  }
  get key() {
    return `${this.uid}.${this.version}`;
  }
  destroy() {}
}

export interface FontMetrics {
  ascent: number;
  descent: number;
  fontSize: number;
}

let measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
function ctx2d() {
  if (measureCtx) return measureCtx;
  const c: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
  measureCtx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  return measureCtx;
}
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;
const graphemes = (s: string) => (segmenter ? [...segmenter.segment(s)].length : [...s].length);

export interface MeasuredText {
  width: number;
  height: number;
  lines: string[];
  lineWidths: number[];
  lineHeight: number;
  maxLineWidth: number;
  fontProperties: FontMetrics;
}

const fontCache = new Map<string, FontMetrics>();
const measureCache = new Map<string, MeasuredText>();

/** Pixi's CanvasTextMetrics: font metrics and the measured block of a text in a style. */
export class CanvasTextMetrics {
  static readonly METRICS_STRING = '|ÉqÅ';
  static readonly BASELINE_SYMBOL = 'M';
  static measureFont(font: string): FontMetrics {
    const hit = fontCache.get(font);
    if (hit) return hit;
    const g = ctx2d();
    g.font = font;
    const m = g.measureText(CanvasTextMetrics.METRICS_STRING + CanvasTextMetrics.BASELINE_SYMBOL);
    const out = { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent, fontSize: 0 };
    out.fontSize = out.ascent + out.descent;
    fontCache.set(font, out);
    return out;
  }
  static measureLine(text: string, style: TextStyle): number {
    const g = ctx2d();
    g.font = style.font;
    const m = g.measureText(text);
    let w = m.width;
    let bw = m.actualBoundingBoxRight + m.actualBoundingBoxLeft;
    if (w > 0) {
      const extra = (graphemes(text) - 1) * style.letterSpacing;
      w += extra;
      bw += extra;
    }
    return Math.max(w, bw);
  }
  static measureText(text: string, style: TextStyle): MeasuredText {
    const key = `${style.font}|${style.letterSpacing}|${style.lineHeight}|${style.leading}|${style.strokeWidth}|${style.wordWrap ? style.wordWrapWidth : 0}|${style.whiteSpace}|${text}`;
    const hit = measureCache.get(key);
    if (hit) return hit;
    const fontProperties = CanvasTextMetrics.measureFont(style.font);
    if (fontProperties.fontSize === 0) {
      fontProperties.fontSize = style.fontSize;
      fontProperties.ascent = style.fontSize;
    }
    const lines = (style.wordWrap ? wrap(text, style) : text).split(/\r\n|\r|\n/);
    const lineWidths = lines.map((l) => CanvasTextMetrics.measureLine(l, style));
    const maxLineWidth = Math.max(0, ...lineWidths);
    const sw = style.strokeWidth;
    const lineHeight = style.lineHeight || fontProperties.fontSize;
    const shadow = style.dropShadow ? style.dropShadow.distance : 0;
    const out: MeasuredText = {
      width: maxLineWidth + sw + shadow,
      height:
        Math.max(lineHeight, fontProperties.fontSize + sw) + (lines.length - 1) * (lineHeight + style.leading) + shadow,
      lines,
      lineWidths,
      lineHeight: lineHeight + style.leading,
      maxLineWidth,
      fontProperties,
    };
    if (measureCache.size > 4000) measureCache.clear();
    measureCache.set(key, out);
    return out;
  }
}

/** Greedy word wrap at `wordWrapWidth` (characters for scripts without spaces; words otherwise). */
function wrap(text: string, style: TextStyle) {
  const max = style.wordWrapWidth;
  return text
    .split('\n')
    .map((para) => {
      const tokens = para.match(/\s+|[　-鿿가-힯＀-￯]|[^\s　-鿿가-힯＀-￯]+/g) ?? [];
      const out: string[] = [];
      let line = '';
      for (const tk of tokens) {
        const next = line + tk;
        if (line && CanvasTextMetrics.measureLine(next.trimEnd(), style) > max) {
          out.push(line.trimEnd());
          line = /^\s+$/.test(tk) ? '' : tk;
        } else line = next;
      }
      out.push(line.trimEnd());
      return out.join('\n');
    })
    .join('\n');
}

export interface TextOptions extends ContainerOptions {
  text?: string | number;
  style?: TextStyle | TextStyleOptions;
  anchor?: number | { x: number; y: number };
  resolution?: number;
  roundPixels?: boolean;
}

export class Text extends Container {
  private value = '';
  private styleValue: TextStyle;
  readonly anchor = new Point();
  resolution: number | null = null;
  roundPixels = false;
  constructor(options: TextOptions = {}) {
    super(options);
    this.value = String(options.text ?? '');
    this.styleValue = options.style instanceof TextStyle ? options.style : new TextStyle(options.style ?? {});
    if (options.anchor !== undefined)
      typeof options.anchor === 'number'
        ? this.anchor.set(options.anchor)
        : this.anchor.set(options.anchor.x, options.anchor.y);
    if (options.resolution) this.resolution = options.resolution;
  }
  get text(): string {
    return this.value;
  }
  set text(v: string | number) {
    this.value = String(v);
  }
  get style(): TextStyle {
    return this.styleValue;
  }
  set style(v: TextStyle | TextStyleOptions) {
    this.styleValue = v instanceof TextStyle ? v : new TextStyle(v);
  }
  get measured(): MeasuredText {
    return CanvasTextMetrics.measureText(this.value, this.styleValue);
  }
  protected override addOwnBounds(bounds: Bounds, m: Matrix) {
    if (!this.value) return;
    const { width: w, height: h } = this.measured;
    const x0 = -this.anchor.x * w,
      y0 = -this.anchor.y * h;
    bounds.addFrame(x0, y0, x0 + w, y0 + h, m);
  }
  override destroy(options: boolean | DestroyOptions = false) {
    super.destroy(options);
  }
}

/** Folia never uses bitmap or HTML text; both are plain canvas text here. */
export { Text as BitmapText, Text as HTMLText };
