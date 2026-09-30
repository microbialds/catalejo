// Detector for color literals outside the generated palette (requirements
// §5.4, §7). Scans the string literals of TypeScript sources, CSS, and HTML
// for hex colors, color functions, and CSS named colors used as values.
import ts from 'typescript';

export interface ColorFinding {
  file: string;
  line: number;
  text: string;
}

/** CSS named colors (CSS Color 4), without transparent and currentColor. */
export const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g;
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/gi;
const DECLARATION = /(?:^|[;{\s"'])(-{0,2}[a-zA-Z][\w-]*)\s*:\s*([^;{}"']+)/g;
const TAILWIND_COLOR_UTILITY =
  /^-?(?:bg|text|border(?:-[xytrblse])?|outline|ring|ring-offset|fill|stroke|decoration|accent|caret|divide|placeholder|shadow|inset-shadow|drop-shadow|text-shadow|from|via|to)-\[?([a-z]+)\]?(?:-\d{2,3})?(?:\/\d+)?$/;

function namedColorsInCssValue(value: string): string[] {
  return (value.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => NAMED_COLORS.has(word));
}

/** Colors found in one piece of text that is a CSS value context. */
export function colorsInText(text: string, options: { css: boolean }): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(HEX)) found.push(match[0]);
  for (const match of text.matchAll(COLOR_FUNCTION)) found.push(match[0]);
  const trimmed = text.trim().toLowerCase();
  if (NAMED_COLORS.has(trimmed)) found.push(trimmed);
  if (options.css) {
    for (const match of text.matchAll(DECLARATION)) {
      const [, property = '', value = ''] = match;
      if (property.toLowerCase().startsWith('http')) continue;
      for (const name of namedColorsInCssValue(value)) found.push(`${property}: ${name}`);
    }
  }
  for (const token of text.split(/\s+/)) {
    const utility = token.replace(/^!/, '').split(':').pop() ?? '';
    const match = TAILWIND_COLOR_UTILITY.exec(utility);
    if (match?.[1] !== undefined && NAMED_COLORS.has(match[1])) found.push(token);
  }
  return found;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Color literals in the string literals of a TypeScript or TSX source. */
export function findColorsInScript(source: string, file = 'input.tsx'): ColorFinding[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: ColorFinding[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | undefined;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text;
    }
    if (text !== undefined) {
      for (const color of colorsInText(text, { css: true })) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({ file, line: line + 1, text: color });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

/** Color literals in a stylesheet, comments excluded. */
export function findColorsInCss(source: string, file = 'input.css'): ColorFinding[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const findings: ColorFinding[] = [];
  for (const match of stripped.matchAll(HEX)) {
    findings.push({ file, line: lineOf(stripped, match.index), text: match[0] });
  }
  for (const match of stripped.matchAll(COLOR_FUNCTION)) {
    findings.push({ file, line: lineOf(stripped, match.index), text: match[0] });
  }
  for (const match of stripped.matchAll(DECLARATION)) {
    const [, property = '', value = ''] = match;
    for (const name of namedColorsInCssValue(value)) {
      findings.push({ file, line: lineOf(stripped, match.index), text: `${property}: ${name}` });
    }
  }
  return findings;
}

/** Color literals in an HTML page: anywhere as hex or functions, and as named
 * colors inside style attributes, style elements and color attributes. */
export function findColorsInHtml(source: string, file = 'index.html'): ColorFinding[] {
  const stripped = source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const findings: ColorFinding[] = [];
  for (const match of stripped.matchAll(HEX)) {
    findings.push({ file, line: lineOf(stripped, match.index), text: match[0] });
  }
  for (const match of stripped.matchAll(COLOR_FUNCTION)) {
    findings.push({ file, line: lineOf(stripped, match.index), text: match[0] });
  }
  const contexts = [
    ...stripped.matchAll(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi),
    ...stripped.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi),
  ];
  for (const match of contexts) {
    const css = match[match.length - 1] ?? '';
    for (const finding of findColorsInCss(css, file)) {
      findings.push({ ...finding, line: lineOf(stripped, match.index) + finding.line - 1 });
    }
  }
  for (const match of stripped.matchAll(
    /\s(?:bgcolor|color|fill|stroke|stop-color)\s*=\s*(["'])([^"']*)\1/gi,
  )) {
    const value = (match[2] ?? '').trim().toLowerCase();
    if (NAMED_COLORS.has(value)) {
      findings.push({ file, line: lineOf(stripped, match.index), text: value });
    }
  }
  return findings;
}
