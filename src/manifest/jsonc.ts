const QUOTE = '"';
const BACKSLASH = "\\";
const SLASH = "/";
const STAR = "*";
const NEWLINE = "\n";
const COMMA = ",";
const CLOSERS = new Set(["}", "]"]);
const COMMENT_LENGTH = 2;

function dropTrailingComma(out: string[]): void {
  let index = out.length - 1;
  while (index >= 0 && /\s/.test(out[index] ?? "")) index -= 1;
  if (index >= 0 && out[index] === COMMA) out.splice(index, 1);
}

function skipLineComment(text: string, start: number): number {
  const end = text.indexOf(NEWLINE, start);
  return end === -1 ? text.length : end;
}

function skipBlockComment(text: string, start: number): number {
  const end = text.indexOf(STAR + SLASH, start + COMMENT_LENGTH);
  return end === -1 ? text.length : end + COMMENT_LENGTH;
}

function copyString(text: string, start: number, out: string[]): number {
  out.push(QUOTE);
  let index = start + 1;
  while (index < text.length) {
    const char = text[index] ?? "";
    out.push(char);
    index += 1;
    if (char === BACKSLASH && index < text.length) {
      out.push(text[index] ?? "");
      index += 1;
    } else if (char === QUOTE) {
      break;
    }
  }
  return index;
}

export function stripJsonc(text: string): string {
  const out: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    const next = text[index + 1];
    if (char === QUOTE) {
      index = copyString(text, index, out);
    } else if (char === SLASH && next === SLASH) {
      index = skipLineComment(text, index);
    } else if (char === SLASH && next === STAR) {
      index = skipBlockComment(text, index);
    } else {
      if (CLOSERS.has(char)) dropTrailingComma(out);
      out.push(char);
      index += 1;
    }
  }
  return out.join("");
}
