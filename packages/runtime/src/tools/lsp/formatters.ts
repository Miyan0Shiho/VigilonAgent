import type {
  Location,
  LocationLink,
  SymbolInformation,
  DocumentSymbol,
  Hover,
  MarkedString,
  MarkupContent,
  Diagnostic,
} from 'vscode-languageserver-protocol';

export function formatLocation(loc: Location | LocationLink): string {
  const uri = 'uri' in loc ? loc.uri : loc.targetUri;
  const range = 'range' in loc ? loc.range : loc.targetRange;
  return `${uri}:${range.start.line + 1}:${range.start.character + 1}`;
}

export function formatHover(hover: Hover): string {
  const contents = hover.contents;
  if (Array.isArray(contents)) {
    return contents.map(formatMarkedString).join('\n\n');
  }
  return formatMarkedString(contents);
}

function formatMarkedString(str: MarkedString | MarkupContent): string {
  if (typeof str === 'string') return str;
  return str.value;
}

export function formatSymbol(symbol: SymbolInformation | DocumentSymbol): string {
  const name = symbol.name;
  const kind = symbol.kind; // We could map this to a string name
  return `${name} (Kind: ${kind})`;
}

export function formatDiagnostic(d: Diagnostic): string {
  const severity = d.severity === 1 ? 'Error' : d.severity === 2 ? 'Warning' : d.severity === 3 ? 'Info' : 'Hint';
  return `[${severity}] ${d.range.start.line + 1}:${d.range.start.character + 1} - ${d.message}`;
}
