// Detector for type and opacity rules of the design system (requirements
// §5.4, §7; checklist G2, G3). Type: no serif face, weights 400 and 700 only
// (font-regular and font-bold), no uppercase labels. Marks: no opacity,
// fill-opacity or stroke-opacity below 1, and no Tailwind opacity utility or
// color opacity modifier, since every painted color must be a palette color
// drawn as is. Text: no text in chrome.text_faint, which config/palette.yaml
// keeps for decoration only and which fails the AA contrast of §9 on the
// panel and chassis colors; a line that truly is decoration carries a comment
// with the word "decorative" (for example `{/* decorative */}`), which allows
// it. Scripts are read through the TypeScript compiler, so comments never
// count otherwise; stylesheets have their comments removed first.
import ts from 'typescript';

export interface DesignFinding {
  file: string;
  line: number;
  text: string;
}

/** Class tokens the design system forbids (after removing variants). */
const FORBIDDEN_CLASS =
  /^(?:font-(?:serif|thin|extralight|light|normal|medium|semibold|extrabold|black)|uppercase)$/;
/** Tailwind opacity utilities other than opacity-100. */
const OPACITY_CLASS = /^opacity-(?!100$)(?:\d+|\[.*\])$/;
/** A color utility with an opacity modifier, such as bg-ink/50. */
const COLOR_MODIFIER =
  /^(?:bg|text|border(?:-[xytrblse])?|outline|ring|fill|stroke|decoration|accent|caret|divide|placeholder)-[\w-]+\/(?:\d+|\[.*\])$/;
/** Text in the faint chrome color, for any variant (disabled:, hover:, ...). */
const FAINT_TEXT_CLASS = 'text-text-faint';
/** The allow comment of a decorative use of the faint color. */
const DECORATIVE_ALLOW = /(?:\/\/|\/\*)\s*decorative\b/;
const OPACITY_PROPERTIES = new Set([
  'opacity',
  'fillOpacity',
  'strokeOpacity',
  'fill-opacity',
  'stroke-opacity',
  'stopOpacity',
  'stop-opacity',
  'floodOpacity',
  'flood-opacity',
]);
const CSS_OPACITY = /(?:^|[;{\s"'`])((?:fill-|stroke-|stop-|flood-)?opacity)\s*:\s*([^;{}"'`]+)/g;

/** Whether a literal opacity value is fully opaque. */
function opaque(value: string): boolean {
  const text = value.trim();
  if (text.endsWith('%')) return Number(text.slice(0, -1)) >= 100;
  const number = Number(text);
  return text !== '' && Number.isFinite(number) && number >= 1;
}

/** Forbidden class tokens in one piece of text. */
export function classFindings(text: string): string[] {
  const found: string[] = [];
  for (const token of text.split(/\s+/)) {
    const utility = token.replace(/^!/, '').split(':').pop() ?? '';
    if (FORBIDDEN_CLASS.test(utility) || OPACITY_CLASS.test(utility)) found.push(token);
    else if (COLOR_MODIFIER.test(utility)) found.push(token);
  }
  return found;
}

/** Class tokens that set text in the faint color. */
export function faintTextFindings(text: string): string[] {
  return text
    .split(/\s+/)
    .filter((token) => (token.replace(/^!/, '').split(':').pop() ?? '') === FAINT_TEXT_CLASS);
}

/** Whether a line of source carries the decorative allow comment. */
function allowsFaint(source: string, line: number): boolean {
  return DECORATIVE_ALLOW.test(source.split('\n')[line - 1] ?? '');
}

/** Opacity declarations below 1 in CSS text (comments already removed). */
function cssOpacityFindings(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CSS_OPACITY)) {
    const [, property = '', value = ''] = match;
    if (!opaque(value)) found.push(`${property}: ${value.trim()}`);
  }
  return found;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function propertyName(name: ts.PropertyName | ts.JsxAttributeName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`;
  return undefined;
}

/** The literal text of an opacity value, or undefined when it is computed. */
function literalValue(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isJsxExpression(node)) return literalValue(node.expression);
  if (ts.isNumericLiteral(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Design rule violations in a TypeScript or TSX source. */
export function findDesignInScript(source: string, file = 'input.tsx'): DesignFinding[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const findings: DesignFinding[] = [];
  const add = (node: ts.Node, text: string) => {
    findings.push({ file, line: lineOf(source, node.getStart(sourceFile)), text });
  };
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
      for (const found of [...classFindings(text), ...cssOpacityFindings(text)]) add(node, found);
      const faint = faintTextFindings(text);
      if (faint.length > 0 && !allowsFaint(source, lineOf(source, node.getStart(sourceFile)))) {
        for (const found of faint) add(node, found);
      }
    }
    // opacity={0.5}, fillOpacity="0.6", style={{ opacity: x }}
    if (ts.isJsxAttribute(node) || ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name !== undefined && OPACITY_PROPERTIES.has(name)) {
        const value = literalValue(node.initializer);
        if (value === undefined || !opaque(value)) add(node, `${name}: ${value ?? 'computed'}`);
      }
    }
    if (ts.isShorthandPropertyAssignment(node) && OPACITY_PROPERTIES.has(node.name.text)) {
      add(node, `${node.name.text}: computed`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

/** Design rule violations in a stylesheet. */
export function findDesignInCss(source: string, file = 'input.css'): DesignFinding[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const findings: DesignFinding[] = [];
  for (const match of stripped.matchAll(CSS_OPACITY)) {
    const [, property = '', value = ''] = match;
    if (!opaque(value)) {
      findings.push({
        file,
        line: lineOf(stripped, match.index),
        text: `${property}: ${value.trim()}`,
      });
    }
  }
  for (const match of stripped.matchAll(/var\(--font-serif\)|--font-weight-(?!regular|bold)\w+/g)) {
    findings.push({ file, line: lineOf(stripped, match.index), text: match[0] });
  }
  for (const match of stripped.matchAll(/text-transform\s*:\s*uppercase/g)) {
    findings.push({ file, line: lineOf(stripped, match.index), text: match[0] });
  }
  for (const match of stripped.matchAll(/@apply([^;]+);/g)) {
    const line = lineOf(stripped, match.index);
    for (const found of classFindings(match[1] ?? '')) {
      findings.push({ file, line, text: found });
    }
    if (!allowsFaint(source, line)) {
      for (const found of faintTextFindings(match[1] ?? ''))
        findings.push({ file, line, text: found });
    }
  }
  for (const match of stripped.matchAll(/(?:^|[;{\s])color\s*:\s*var\(--color-text-faint\)/g)) {
    const line = lineOf(stripped, match.index + match[0].search(/color/));
    if (!allowsFaint(source, line)) findings.push({ file, line, text: 'color: text-faint' });
  }
  return findings;
}
