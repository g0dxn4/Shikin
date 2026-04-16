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
  cargoLock: path.join(rootDir, 'src-tauri/Cargo.lock'),
  cli: path.join(rootDir, 'cli/src/cli.ts'),
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

function parseCliVersion(cliSource) {
  const match = cliSource.match(/\.version\(\s*['"]([^'"]+)['"]\s*\)/)
  if (!match) {
    throw new Error('Could not locate CLI version in cli/src/cli.ts')
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

function parseCargoLockPackageVersions(cargoLock) {
  const versions = new Map()
  const packagePattern = /\[\[package\]\]\s+name\s*=\s*"([^"]+)"\s+version\s*=\s*"([^"]+)"/g

  let match = packagePattern.exec(cargoLock)
  while (match) {
    versions.set(match[1], match[2])
    match = packagePattern.exec(cargoLock)
  }

  return versions
}

function parseCargoLockShikinVersion(cargoLockRaw) {
  const cargoPackages = parseCargoLockPackageVersions(cargoLockRaw)
  const shikinVersion = cargoPackages.get('shikin')

  if (!shikinVersion) {
    throw new Error('Could not locate shikin package version in src-tauri/Cargo.lock')
  }

  return shikinVersion
}

function parseMajorMinor(version, source) {
  const match = String(version).match(/(\d+)\.(\d+)\.\d+/)
  if (!match) {
    throw new Error(`Could not parse major/minor version from ${source}: "${version}"`)
  }

  return `${match[1]}.${match[2]}`
}

function validateTauriPluginParity(rootPackage, cargoLockRaw) {
  const errors = []
  const dependencyMap = {
    ...(rootPackage.dependencies ?? {}),
    ...(rootPackage.devDependencies ?? {}),
  }
  const cargoPackages = parseCargoLockPackageVersions(cargoLockRaw)

  const sqlJs = dependencyMap['@tauri-apps/plugin-sql']
  const sqlRust = cargoPackages.get('tauri-plugin-sql')

  if (!sqlJs || !sqlRust) {
    errors.push(
      'Missing plugin-sql dependency on one side (package.json @tauri-apps/plugin-sql / src-tauri/Cargo.lock tauri-plugin-sql)'
    )
  }

  for (const [jsPackage, jsVersion] of Object.entries(dependencyMap)) {
    if (!jsPackage.startsWith('@tauri-apps/plugin-')) {
      continue
    }

    const suffix = jsPackage.replace('@tauri-apps/plugin-', '')
    const rustCrate = `tauri-plugin-${suffix}`
    const rustVersion = cargoPackages.get(rustCrate)

    if (!rustVersion) {
      errors.push(
        `Tauri plugin mismatch: ${jsPackage} is declared in package.json but ${rustCrate} is missing from src-tauri/Cargo.lock`
      )
      continue
    }

    try {
      const jsMajorMinor = parseMajorMinor(jsVersion, `package.json ${jsPackage}`)
      const rustMajorMinor = parseMajorMinor(rustVersion, `src-tauri/Cargo.lock ${rustCrate}`)

      if (jsMajorMinor !== rustMajorMinor) {
        errors.push(
          `Tauri plugin major/minor mismatch: ${rustCrate} (v${rustVersion}) vs ${jsPackage} (v${jsVersion})`
        )
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  return errors
}

async function main() {
  const [
    rootPackageRaw,
    cliPackageRaw,
    tauriConfigRaw,
    cargoTomlRaw,
    cargoLockRaw,
    cliRaw,
    mcpServerRaw,
  ] = await Promise.all([
    readFile(files.rootPackage, 'utf8'),
    readFile(files.cliPackage, 'utf8'),
    readFile(files.tauriConfig, 'utf8'),
    readFile(files.cargoToml, 'utf8'),
    readFile(files.cargoLock, 'utf8'),
    readFile(files.cli, 'utf8'),
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
    'src-tauri/Cargo.lock (package shikin)': parseCargoLockShikinVersion(cargoLockRaw),
    'cli/src/cli.ts': parseCliVersion(cliRaw),
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

  errors.push(...validateTauriPluginParity(rootPackage, cargoLockRaw))

  if (errors.length > 0) {
    for (const error of errors) {
      fail(error)
    }

    process.exit(1)
  }

  ok(`Release versions are in sync at ${uniqueVersions[0]}`)
  ok('Updater configuration checks passed')
  ok('Tauri JS/Rust plugin major/minor versions are aligned')

  if (tagVersion) {
    ok(`Git tag version matches release files (${tagVersion})`)
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
