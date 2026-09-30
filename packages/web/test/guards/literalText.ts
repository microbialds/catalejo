// Detector for literal interface text in components (requirements §3). Uses
// the TypeScript compiler API to find JSX text, string literals rendered as
// JSX children, and string literals in user-visible JSX attributes.
import ts from 'typescript';

export interface LiteralFinding {
  file: string;
  line: number;
  kind: 'jsx-text' | 'jsx-child' | 'attribute';
  text: string;
}

/** Attributes whose value is shown or announced to the user. */
export const VISIBLE_ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'placeholder',
  'alt',
  'label',
]);

/** Literal string parts of an expression that would reach the screen. */
function literalParts(expression: ts.Expression): string[] {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression.text];
  }
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)];
  }
  if (ts.isParenthesizedExpression(expression)) return literalParts(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return [...literalParts(expression.whenTrue), ...literalParts(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind;
    if (
      op === ts.SyntaxKind.PlusToken ||
      op === ts.SyntaxKind.BarBarToken ||
      op === ts.SyntaxKind.QuestionQuestionToken ||
      op === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return [...literalParts(expression.left), ...literalParts(expression.right)];
    }
  }
  return [];
}

function tagName(attribute: ts.JsxAttribute): string {
  const element = attribute.parent.parent;
  return element.tagName.getText();
}

export function findLiteralText(source: string, file = 'input.tsx'): LiteralFinding[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: LiteralFinding[] = [];
  const report = (node: ts.Node, kind: LiteralFinding['kind'], text: string) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({ file, line: line + 1, kind, text: text.trim() });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (node.text.trim() !== '') report(node, 'jsx-text', node.text);
    } else if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const text of literalParts(node.expression)) {
        if (text.trim() !== '') report(node, 'jsx-child', text);
      }
    } else if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const name = node.name.getText(sourceFile);
      const visible =
        VISIBLE_ATTRIBUTES.has(name) || (name === 'value' && tagName(node) === 'option');
      if (visible) {
        const init = node.initializer;
        const parts = ts.isStringLiteral(init)
          ? [init.text]
          : ts.isJsxExpression(init) && init.expression !== undefined
            ? literalParts(init.expression)
            : [];
        for (const text of parts) {
          if (text.trim() !== '') report(node, 'attribute', `${name}=${text}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}
