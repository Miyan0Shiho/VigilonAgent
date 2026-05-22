import { randomUUID } from 'crypto';
import { pathToFileURL } from 'node:url';
import type { Diagnostic } from 'vscode-languageserver-protocol';

export type DiagnosticFile = {
  uri: string;
  diagnostics: Diagnostic[];
};

export type PendingLSPDiagnostic = {
  serverName: string;
  files: DiagnosticFile[];
  timestamp: number;
  attachmentSent: boolean;
};

const MAX_DIAGNOSTICS_PER_FILE = 10;
const MAX_TOTAL_DIAGNOSTICS = 30;
const MAX_TRACKED_FILES = 100;

const pendingDiagnostics = new Map<string, PendingLSPDiagnostic>();
const deliveredDiagnostics = new Map<string, Set<string>>();
const latestDiagnosticsByFile = new Map<string, Diagnostic[]>();

export function registerPendingLSPDiagnostic({
  serverName,
  files,
}: {
  serverName: string;
  files: DiagnosticFile[];
}): void {
  const diagnosticId = randomUUID();

  for (const file of files) {
    latestDiagnosticsByFile.set(file.uri, [...file.diagnostics]);
  }

  pendingDiagnostics.set(diagnosticId, {
    serverName,
    files,
    timestamp: Date.now(),
    attachmentSent: false,
  });
}

export function checkForLSPDiagnostics(): Array<{
  serverName: string;
  files: DiagnosticFile[];
}> {
  const allFiles: DiagnosticFile[] = [];
  const serverNames = new Set<string>();
  const diagnosticsToMark: PendingLSPDiagnostic[] = [];

  for (const diagnostic of pendingDiagnostics.values()) {
    if (!diagnostic.attachmentSent) {
      allFiles.push(...diagnostic.files);
      serverNames.add(diagnostic.serverName);
      diagnosticsToMark.push(diagnostic);
    }
  }

  if (allFiles.length === 0) {
    return [];
  }

  const dedupedFiles = deduplicateDiagnosticFiles(allFiles);

  for (const diagnostic of diagnosticsToMark) {
    diagnostic.attachmentSent = true;
  }
  
  for (const [id, diagnostic] of pendingDiagnostics) {
    if (diagnostic.attachmentSent) {
      pendingDiagnostics.delete(id);
    }
  }

  // Volume limiting
  let totalDiagnostics = 0;
  for (const file of dedupedFiles) {
    file.diagnostics.sort((a, b) => (a.severity ?? 4) - (b.severity ?? 4));

    if (file.diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
      file.diagnostics = file.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE);
    }

    const remainingCapacity = MAX_TOTAL_DIAGNOSTICS - totalDiagnostics;
    if (file.diagnostics.length > remainingCapacity) {
      file.diagnostics = file.diagnostics.slice(0, remainingCapacity);
    }

    totalDiagnostics += file.diagnostics.length;
  }

  const finalFiles = dedupedFiles.filter((f) => f.diagnostics.length > 0);

  // Track delivered
  for (const file of finalFiles) {
    if (!deliveredDiagnostics.has(file.uri)) {
      if (deliveredDiagnostics.size >= MAX_TRACKED_FILES) {
        const firstKey = deliveredDiagnostics.keys().next().value;
        if (firstKey !== undefined) deliveredDiagnostics.delete(firstKey);
      }
      deliveredDiagnostics.set(file.uri, new Set());
    }
    const delivered = deliveredDiagnostics.get(file.uri)!;
    for (const diag of file.diagnostics) {
      delivered.add(createDiagnosticKey(diag));
    }
  }

  if (finalFiles.length === 0) return [];

  return [
    {
      serverName: Array.from(serverNames).join(', '),
      files: finalFiles,
    },
  ];
}

function deduplicateDiagnosticFiles(allFiles: DiagnosticFile[]): DiagnosticFile[] {
  const fileMap = new Map<string, Set<string>>();
  const dedupedFiles: DiagnosticFile[] = [];

  for (const file of allFiles) {
    if (!fileMap.has(file.uri)) {
      fileMap.set(file.uri, new Set());
      dedupedFiles.push({ uri: file.uri, diagnostics: [] });
    }

    const seenDiagnostics = fileMap.get(file.uri)!;
    const dedupedFile = dedupedFiles.find((f) => f.uri === file.uri)!;
    const previouslyDelivered = deliveredDiagnostics.get(file.uri) || new Set();

    for (const diag of file.diagnostics) {
      const key = createDiagnosticKey(diag);
      if (seenDiagnostics.has(key) || previouslyDelivered.has(key)) {
        continue;
      }
      seenDiagnostics.add(key);
      dedupedFile.diagnostics.push(diag);
    }
  }

  return dedupedFiles.filter((f) => f.diagnostics.length > 0);
}

function createDiagnosticKey(diag: Diagnostic): string {
  return JSON.stringify({
    message: diag.message,
    severity: diag.severity,
    range: diag.range,
    source: diag.source,
    code: diag.code,
  });
}

export function clearDeliveredDiagnosticsForFile(fileUri: string): void {
  deliveredDiagnostics.delete(fileUri);
}

export function getLatestDiagnosticsForFile(filePath: string): Diagnostic[] {
  const fileUri = pathToFileURL(filePath).href;
  return [...(latestDiagnosticsByFile.get(fileUri) ?? [])];
}

export function resetAllLSPDiagnosticState(): void {
  pendingDiagnostics.clear();
  deliveredDiagnostics.clear();
  latestDiagnosticsByFile.clear();
}
