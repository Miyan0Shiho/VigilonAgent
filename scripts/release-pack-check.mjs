import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const packages = [
  {
    name: '@vigilon/runtime',
    dir: path.join(root, 'packages/runtime'),
    required: ['package/package.json', 'package/README.md', 'package/dist/index.js', 'package/dist/cli.js'],
  },
  {
    name: '@vigilon/tui',
    dir: path.join(root, 'packages/tui'),
    required: ['package/package.json', 'package/README.md', 'package/dist/index.js', 'package/dist/entrypoints/cli.js'],
  },
]

const forbiddenPatterns = [
  /^package\/\.vigilon\//,
  /^package\/src\//,
  /^package\/test\//,
  /^package\/scripts\//,
  /\.test\.(?:js|d\.ts|js\.map)$/,
  /\.DS_Store$/,
]

const packDir = mkdtempSync(path.join(tmpdir(), 'vigilon-pack-check-'))

try {
  const summaries = packages.map(pkg => checkPackage(pkg))
  console.log(JSON.stringify({ status: 'pack_check_ok', packages: summaries }, null, 2))
} finally {
  rmSync(packDir, { recursive: true, force: true })
}

function checkPackage(pkg) {
  const stdout = execFileSync('pnpm', [
    '--dir',
    pkg.dir,
    'pack',
    '--pack-destination',
    packDir,
    '--json',
  ], {
    cwd: root,
    env: releaseEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const packed = JSON.parse(stdout)
  const tarball = Array.isArray(packed) ? packed[0] : packed
  if (!tarball?.filename) {
    throw new Error(`pnpm pack did not return a tarball for ${pkg.name}`)
  }

  const tarballPath = path.isAbsolute(tarball.filename)
    ? tarball.filename
    : path.join(packDir, tarball.filename)
  const files = listTarball(tarballPath)
  const missing = pkg.required.filter(file => !files.includes(file))
  if (missing.length) {
    throw new Error(`${pkg.name} package is missing required files: ${missing.join(', ')}`)
  }

  const forbidden = files.filter(file => forbiddenPatterns.some(pattern => pattern.test(file)))
  if (forbidden.length) {
    throw new Error(`${pkg.name} package includes forbidden files: ${forbidden.join(', ')}`)
  }

  const packageJson = JSON.parse(execFileSync('tar', [
    '-xOf',
    tarballPath,
    'package/package.json',
  ], {
    cwd: root,
    env: releaseEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
  const serialized = JSON.stringify(packageJson)
  if (serialized.includes('workspace:')) {
    throw new Error(`${pkg.name} package.json still contains a workspace: dependency`)
  }

  return {
    name: pkg.name,
    version: packageJson.version,
    filename: tarball.filename,
    entryCount: files.length,
  }
}

function listTarball(tarballPath) {
  return execFileSync('tar', ['-tf', tarballPath], {
    cwd: root,
    env: releaseEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .filter(Boolean)
    .map(file => file.replace(/^\.\//, ''))
}

function releaseEnv() {
  return {
    ...process.env,
    LC_ALL: 'C',
    LANG: 'C',
  }
}
