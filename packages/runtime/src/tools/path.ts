import path from 'node:path'

export function resolveToolPath(cwd: string, inputPath: string): string {
  return path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(cwd, inputPath)
}

export function toRelativeToolPath(cwd: string, absolutePath: string): string {
  const relative = path.relative(cwd, absolutePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return absolutePath
  }
  return relative.split(path.sep).join('/')
}

export function isUncPath(filePath: string): boolean {
  return filePath.startsWith('\\\\') || filePath.startsWith('//')
}

export function isBlockedDevicePath(filePath: string): boolean {
  if (
    filePath === '/dev/zero' ||
    filePath === '/dev/random' ||
    filePath === '/dev/urandom' ||
    filePath === '/dev/full' ||
    filePath === '/dev/stdin' ||
    filePath === '/dev/tty' ||
    filePath === '/dev/console' ||
    filePath === '/dev/stdout' ||
    filePath === '/dev/stderr'
  ) {
    return true
  }

  return (
    filePath.startsWith('/proc/') &&
    (filePath.endsWith('/fd/0') ||
      filePath.endsWith('/fd/1') ||
      filePath.endsWith('/fd/2'))
  )
}
