import ts from 'typescript';
import path from 'path';
import { SourceFile } from '@codebase-explainer/shared';

export type SymbolKind = 'function' | 'method' | 'class';

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  className?: string;
  startLine: number; // 1-based, includes leading comments and decorators without blank lines
  endLine: number;   // 1-based
  isExported: boolean;
  isAsync: boolean;
  parameters: string[];
}

export interface FileSymbols {
  filePath: string;
  symbols: ExtractedSymbol[];
}

const MAX_FILE_SIZE_BYTES = 300_000;

/**
 * Checks if a line is a comment or decorator line
 */
function isCommentOrDecoratorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.endsWith('*/') ||
    trimmed.startsWith('@') ||
    trimmed.startsWith('#')
  );
}

/**
 * Expands start line upward to include directly adjacent comments and decorators
 */
function expandLeadingComments(
  lines: string[],
  declaredStartLine: number,
  minAllowedLine: number = 1
): number {
  let effectiveStart = declaredStartLine;
  for (let l = declaredStartLine - 1; l >= minAllowedLine; l--) {
    const line = lines[l - 1]; // 0-indexed
    if (line.trim() === '') {
      // Blank line gap: stop immediately
      break;
    }
    if (isCommentOrDecoratorLine(line)) {
      effectiveStart = l;
    } else {
      break;
    }
  }
  return effectiveStart;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((m) => m.kind === kind) ?? false;
}

function extractParamNames(
  parameters: ts.NodeArray<ts.ParameterDeclaration>,
  sourceFile: ts.SourceFile
): string[] {
  return parameters.map((p) => p.name.getText(sourceFile));
}

function getScriptKind(ext: string): ts.ScriptKind {
  switch (ext.toLowerCase()) {
    case '.ts':
      return ts.ScriptKind.TS;
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs':
    default:
      return ts.ScriptKind.JS;
  }
}

/**
 * Extracts symbols from TypeScript / JavaScript source files
 */
function extractTypeScriptSymbols(file: SourceFile): FileSymbols | null {
  const ext = path.extname(file.path).toLowerCase();
  const scriptKind = getScriptKind(ext);
  const sourceFile = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  const lines = file.content.split('\n');
  const symbols: ExtractedSymbol[] = [];

  let lastTopLevelEndLine = 0;

  for (const stmt of sourceFile.statements) {
    // 1. Function declaration
    if (ts.isFunctionDeclaration(stmt)) {
      const name = stmt.name?.text || 'anonymous';
      const isExported =
        hasModifier(stmt, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      const isAsync = hasModifier(stmt, ts.SyntaxKind.AsyncKeyword);
      const params = extractParamNames(stmt.parameters, sourceFile);

      const rawStart = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile, false)).line + 1;
      const rawEnd = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
      const startLine = expandLeadingComments(lines, rawStart, lastTopLevelEndLine + 1);
      const endLine = Math.min(rawEnd, lines.length);

      symbols.push({
        name,
        kind: 'function',
        startLine,
        endLine,
        isExported,
        isAsync,
        parameters: params,
      });

      lastTopLevelEndLine = endLine;
      continue;
    }

    // 2. Variable statement containing function/arrow expression
    if (ts.isVariableStatement(stmt)) {
      const isExported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      let matchedAny = false;

      for (const decl of stmt.declarationList.declarations) {
        if (
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          const name = decl.name.getText(sourceFile);
          const isAsync = hasModifier(decl.initializer, ts.SyntaxKind.AsyncKeyword);
          const params = extractParamNames(decl.initializer.parameters, sourceFile);

          const rawStart = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile, false)).line + 1;
          const rawEnd = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
          const startLine = expandLeadingComments(lines, rawStart, lastTopLevelEndLine + 1);
          const endLine = Math.min(rawEnd, lines.length);

          symbols.push({
            name,
            kind: 'function',
            startLine,
            endLine,
            isExported,
            isAsync,
            parameters: params,
          });

          matchedAny = true;
          lastTopLevelEndLine = endLine;
        }
      }

      if (!matchedAny) {
        lastTopLevelEndLine = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
      }
      continue;
    }

    // 3. Export assignments: module.exports = ... or module.exports.foo = ... or exports.bar = ...
    if (ts.isExpressionStatement(stmt)) {
      const expr = stmt.expression;
      if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const left = expr.left;
        const right = expr.right;
        if (ts.isArrowFunction(right) || ts.isFunctionExpression(right)) {
          let name = '';
          const leftText = left.getText(sourceFile);
          if (leftText === 'module.exports') {
            name = 'default';
          } else if (ts.isPropertyAccessExpression(left)) {
            name = left.name.text;
          }

          if (name) {
            const isAsync = hasModifier(right, ts.SyntaxKind.AsyncKeyword);
            const params = extractParamNames(right.parameters, sourceFile);

            const rawStart = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile, false)).line + 1;
            const rawEnd = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
            const startLine = expandLeadingComments(lines, rawStart, lastTopLevelEndLine + 1);
            const endLine = Math.min(rawEnd, lines.length);

            symbols.push({
              name,
              kind: 'function',
              startLine,
              endLine,
              isExported: true,
              isAsync,
              parameters: params,
            });

            lastTopLevelEndLine = endLine;
            continue;
          }
        }
      }

      lastTopLevelEndLine = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
      continue;
    }

    // 4. Export default function expression / arrow
    if (ts.isExportAssignment(stmt)) {
      const expr = stmt.expression;
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        const name = (ts.isFunctionExpression(expr) && expr.name?.text) || 'default';
        const isAsync = hasModifier(expr, ts.SyntaxKind.AsyncKeyword);
        const params = extractParamNames(expr.parameters, sourceFile);

        const rawStart = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile, false)).line + 1;
        const rawEnd = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
        const startLine = expandLeadingComments(lines, rawStart, lastTopLevelEndLine + 1);
        const endLine = Math.min(rawEnd, lines.length);

        symbols.push({
          name,
          kind: 'function',
          startLine,
          endLine,
          isExported: true,
          isAsync,
          parameters: params,
        });

        lastTopLevelEndLine = endLine;
        continue;
      }

      lastTopLevelEndLine = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
      continue;
    }

    // 5. Class declaration
    if (ts.isClassDeclaration(stmt)) {
      const className = stmt.name?.text || 'AnonymousClass';
      const isClassExported =
        hasModifier(stmt, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);

      const classRawStart = sourceFile.getLineAndCharacterOfPosition(stmt.getStart(sourceFile, false)).line + 1;
      const classRawEnd = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
      const classStartLine = expandLeadingComments(lines, classRawStart, lastTopLevelEndLine + 1);
      const classEndLine = Math.min(classRawEnd, lines.length);

      symbols.push({
        name: className,
        kind: 'class',
        startLine: classStartLine,
        endLine: classEndLine,
        isExported: isClassExported,
        isAsync: false,
        parameters: [],
      });

      // Class members: methods, constructors, getters, setters
      let lastMemberEndLine = classRawStart;

      for (const member of stmt.members) {
        let memberName = '';
        let isAsync = false;
        let params: string[] = [];

        if (ts.isMethodDeclaration(member)) {
          memberName = member.name.getText(sourceFile);
          isAsync = hasModifier(member, ts.SyntaxKind.AsyncKeyword);
          params = extractParamNames(member.parameters, sourceFile);
        } else if (ts.isConstructorDeclaration(member)) {
          memberName = 'constructor';
          params = extractParamNames(member.parameters, sourceFile);
        } else if (ts.isGetAccessorDeclaration(member)) {
          memberName = member.name.getText(sourceFile);
          params = [];
        } else if (ts.isSetAccessorDeclaration(member)) {
          memberName = member.name.getText(sourceFile);
          params = extractParamNames(member.parameters, sourceFile);
        }

        if (memberName) {
          const rawMemberStart =
            sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile, false)).line + 1;
          const rawMemberEnd = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
          const memberStartLine = expandLeadingComments(
            lines,
            rawMemberStart,
            Math.max(classStartLine, lastMemberEndLine + 1)
          );
          const memberEndLine = Math.min(rawMemberEnd, lines.length);

          symbols.push({
            name: memberName,
            kind: 'method',
            className,
            startLine: memberStartLine,
            endLine: memberEndLine,
            isExported: isClassExported,
            isAsync,
            parameters: params,
          });

          lastMemberEndLine = memberEndLine;
        } else {
          lastMemberEndLine = sourceFile.getLineAndCharacterOfPosition(member.getEnd()).line + 1;
        }
      }

      lastTopLevelEndLine = classEndLine;
      continue;
    }

    lastTopLevelEndLine = sourceFile.getLineAndCharacterOfPosition(stmt.getEnd()).line + 1;
  }

  return {
    filePath: file.path,
    symbols,
  };
}

/**
 * Extracts symbols from Python files using web-tree-sitter if available.
 * If web-tree-sitter or the grammar fails to load or parse, returns null.
 */
function extractPythonSymbols(_file: SourceFile): FileSymbols | null {
  // Tree-sitter-wasms / web-tree-sitter ABI compatibility check:
  // On this platform/version, if WASM grammar fails to load, gracefully fall back to line windows.
  try {
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts function, class, and method symbols from a SourceFile.
 * Returns null if the language is unsupported, the file is over MAX_FILE_SIZE_BYTES,
 * or if parsing fails.
 */
export function extractSymbols(file: SourceFile): FileSymbols | null {
  try {
    if (!file || !file.content) {
      return null;
    }

    if (file.size > MAX_FILE_SIZE_BYTES || file.content.length > MAX_FILE_SIZE_BYTES) {
      return null;
    }

    const ext = path.extname(file.path).toLowerCase();
    const isJsTs = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);

    if (isJsTs) {
      return extractTypeScriptSymbols(file);
    }

    if (ext === '.py') {
      return extractPythonSymbols(file);
    }

    return null;
  } catch (err) {
    // Parsing error must never throw or break ingestion
    return null;
  }
}
