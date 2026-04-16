#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const files = {
  rootPackage: path.join(rootDir, 'package.json'),
  cliPackage: path.join(rootDir, 'cli/package.json'),
  tauriConfig: path.join(rootDir, 'src-tauri/tauri.conf.json'),
  cargoToml: path.join(rootDir, 'src-tauri/Cargo.toml'),
  mcpServer: path.join(rootDir, 'cli/src/mcp-server.ts'),
}

const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const updaterPubkeyPattern = /^[A-Za-z0-9+/=]+$/

function fail(message) {
  console.error(`❌ ${message}`)
}

function ok(message) {
  console.log(`✅ ${message}`)
}

function parseCargoVersion(cargoToml) {
  const packageSectionMatch = cargoToml.match(/\[package\]([\s\S]*?)(\n\[|$)/)
  if (!packageSectionMatch) {
    throw new Error('Could not locate [package] section in src-tauri/Cargo.toml')
  }

  const versionMatch = packageSectionMatch[1].match(/\bversion\s*=\s*"([^"]+)"/)
  if (!versionMatch) {
    throw new Error('Could not locate package version in src-tauri/Cargo.toml')
  }

  return versionMatch[1]
}

function parseMcpServerVersion(mcpServerSource) {
  const match = mcpServerSource.match(
    /new\s+McpServer\(\s*\{[\s\S]*?\bversion\s*:\s*['"]([^'"]+)['"]/
  )
  if (!match) {
    throw new Error('Could not locate McpServer version in cli/src/mcp-server.ts')
  }

  return match[1]
}

function parseTagVersion() {
  const refType = process.env.GITHUB_REF_TYPE
  const refName = process.env.GITHUB_REF_NAME

  if (refType !== 'tag' || !refName) {
    return null
  }

  return refName.startsWith('v') ? refName.slice(1) : refName
}

function validateUpdaterEndpoint(endpoint, index) {
  const label = `src-tauri/tauri.conf.json plugins.updater.endpoints[${index}]`

  if (typeof endpoint !== 'string') {
    return [`${label} must be a string URL`]
  }

  const errors = []

  if (!endpoint.startsWith('https://')) {
    errors.push(`Updater endpoint must use HTTPS: "${endpoint}"`)
  }

  if (!endpoint.endsWith('/releases/latest/download/latest.json')) {
    errors.push(
      `${label} must target latest.json release manifest (…/releases/latest/download/latest.json)`
    )
  }

  return errors
}

async function main() {
  const [rootPackageRaw, cliPackageRaw, tauriConfigRaw, cargoTomlRaw, mcpServerRaw] =
    await Promise.all([
      readFile(files.rootPackage, 'utf8'),
      readFile(files.cliPackage, 'utf8'),
      readFile(files.tauriConfig, 'utf8'),
      readFile(files.cargoToml, 'utf8'),
      readFile(files.mcpServer, 'utf8'),
    ])

  const rootPackage = JSON.parse(rootPackageRaw)
  const cliPackage = JSON.parse(cliPackageRaw)
  const tauriConfig = JSON.parse(tauriConfigRaw)

  const versions = {
    'package.json': rootPackage.version,
    'cli/package.json': cliPackage.version,
    'src-tauri/tauri.conf.json': tauriConfig.version,
    'src-tauri/Cargo.toml': parseCargoVersion(cargoTomlRaw),
    'cli/src/mcp-server.ts': parseMcpServerVersion(mcpServerRaw),
  }

  const errors = []

  for (const [source, version] of Object.entries(versions)) {
    if (!version || typeof version !== 'string') {
      errors.push(`${source} is missing a version string`)
      continue
    }

    if (!semverPattern.test(version)) {
      errors.push(`${source} has invalid semver version: "${version}"`)
    }
  }

  const uniqueVersions = [...new Set(Object.values(versions))]
  if (uniqueVersions.length !== 1) {
    const printed = Object.entries(versions)
      .map(([source, version]) => `  - ${source}: ${version}`)
      .join('\n')
    errors.push(`Version mismatch detected across release files:\n${printed}`)
  }

  const tagVersion = parseTagVersion()
  if (tagVersion && uniqueVersions.length === 1 && uniqueVersions[0] !== tagVersion) {
    errors.push(
      `Tag version mismatch: git tag is "${tagVersion}" but release files are "${uniqueVersions[0]}"`
    )
  }

  const updaterConfig = tauriConfig?.plugins?.updater
  const endpoints = updaterConfig?.endpoints
  const pubkey = updaterConfig?.pubkey
  const createUpdaterArtifacts = tauriConfig?.bundle?.createUpdaterArtifacts

  if (!updaterConfig) {
    errors.push('src-tauri/tauri.conf.json is missing plugins.updater config')
  }

  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    errors.push('src-tauri/tauri.conf.json plugins.updater.endpoints must contain at least one URL')
  } else {
    for (const [index, endpoint] of endpoints.entries()) {
      errors.push(...validateUpdaterEndpoint(endpoint, index))
    }
  }

  if (typeof pubkey !== 'string' || pubkey.trim().length < 32) {
    errors.push('src-tauri/tauri.conf.json plugins.updater.pubkey must be a non-empty signing key')
  } else if (!updaterPubkeyPattern.test(pubkey.trim())) {
    errors.push('src-tauri/tauri.conf.json plugins.updater.pubkey must look like a base64 key')
  }

  if (createUpdaterArtifacts !== true) {
    errors.push('src-tauri/tauri.conf.json bundle.createUpdaterArtifacts must be true')
  }

  if (errors.length > 0) {
    for (const error of errors) {
      fail(error)
    }

    process.exit(1)
  }

  ok(`Release versions are in sync at ${uniqueVersions[0]}`)
  ok('Updater configuration checks passed')

  if (tagVersion) {
    ok(`Git tag version matches release files (${tagVersion})`)
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
