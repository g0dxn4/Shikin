#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUIRED_PLATFORMS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'linux-x86_64',
  'windows-x86_64',
]

function fail(message) {
  console.error(`❌ ${message}`)
}

export function normalizeReleaseVersion(tagOrVersion) {
  const value = String(tagOrVersion ?? '').trim()
  if (!value) {
    throw new Error('Release tag/version is required')
  }

  return value.startsWith('v') ? value.slice(1) : value
}

function asAssetNameSet(assetNames) {
  return new Set(
    (assetNames ?? [])
      .map((asset) => (typeof asset === 'string' ? asset : asset?.name))
      .filter(Boolean)
  )
}

export function parseReleaseAssetUrl(url, { repo, tag }) {
  if (typeof url !== 'string' || url.trim() === '') {
    return { error: 'Asset URL is empty' }
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { error: `Asset URL is invalid: ${url}` }
  }

  if (parsed.protocol !== 'https:') {
    return { error: `Asset URL must use HTTPS: ${url}` }
  }

  if (parsed.username || parsed.password) {
    return { error: `Asset URL must not include credentials: ${url}` }
  }

  if (parsed.origin.toLowerCase() !== 'https://github.com') {
    return { error: `Asset URL must be on github.com for ${repo}: ${url}` }
  }

  const expectedPathPrefix = `/${repo}/releases/download/${tag}/`
  if (!parsed.pathname.toLowerCase().startsWith(expectedPathPrefix.toLowerCase())) {
    return { error: `Asset URL must point at ${repo} tag ${tag}: ${url}` }
  }

  let filename
  try {
    filename = decodeURIComponent(parsed.pathname.slice(expectedPathPrefix.length))
  } catch {
    return { error: `Asset URL has an invalid filename: ${url}` }
  }

  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename === '.' ||
    filename === '..'
  ) {
    return { error: `Asset URL must point at an uploaded release file for ${tag}: ${url}` }
  }

  return { filename }
}

function validatePlatformEntry(platform, entry, { repo, tag, assetNames }) {
  const errors = []
  const label = `latest.json platforms.${platform}`

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return [`${label} must be an object with signature and url`]
  }

  const signature = typeof entry.signature === 'string' ? entry.signature.trim() : ''
  if (!signature) {
    errors.push(`${label} is missing a non-empty signature`)
  }

  const parsedUrl = parseReleaseAssetUrl(entry.url, { repo, tag })
  if (parsedUrl.error) {
    errors.push(`${label} ${parsedUrl.error}`)
    return errors
  }

  if (!assetNames.has(parsedUrl.filename)) {
    errors.push(`${label} URL points at missing uploaded asset: ${parsedUrl.filename}`)
  }

  if (!assetNames.has(`${parsedUrl.filename}.sig`)) {
    errors.push(`${label} is missing uploaded signature asset: ${parsedUrl.filename}.sig`)
  }

  return errors
}

export function validateReleaseAssets({ tag, repo, isDraft, assetNames, manifest } = {}) {
  const errors = []

  if (!tag || !String(tag).trim()) {
    errors.push('Release tag is required')
  }

  if (!repo || !String(repo).trim()) {
    errors.push('GitHub repository is required')
  }

  if (isDraft !== true) {
    errors.push('Release is already published before finalization step.')
  }

  if (!String(tag ?? '').trim() || !String(repo ?? '').trim()) {
    return { errors }
  }

  const version = normalizeReleaseVersion(tag)
  const names = asAssetNameSet(assetNames)
  const sourceAsset = `shikin-cli-source-${tag}.tar.gz`
  const requiredAssets = ['latest.json', sourceAsset, `${sourceAsset}.sha256`]
  const missingAssets = requiredAssets.filter((name) => !names.has(name)).sort()

  if (missingAssets.length > 0) {
    errors.push(`Missing expected release assets before publish: ${missingAssets.join(', ')}`)
  }

  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    if (names.has('latest.json')) {
      errors.push('latest.json is present but could not be read as JSON')
    }
    return { errors }
  }

  if (manifest.version !== version) {
    errors.push(`latest.json version "${manifest.version}" does not match tag version "${version}"`)
  }

  const platforms = manifest.platforms
  if (!platforms || typeof platforms !== 'object' || Array.isArray(platforms)) {
    errors.push('latest.json is missing platforms')
    return { errors }
  }

  for (const platform of REQUIRED_PLATFORMS) {
    if (!Object.hasOwn(platforms, platform)) {
      errors.push(`latest.json is missing required platform: ${platform}`)
    }
  }

  for (const [platform, entry] of Object.entries(platforms)) {
    errors.push(...validatePlatformEntry(platform, entry, { repo, tag, assetNames: names }))
  }

  return { errors }
}

function main() {
  const tag = process.env.GITHUB_REF_NAME
  const repo = process.env.GITHUB_REPOSITORY

  if (!tag || !repo) {
    throw new Error('GITHUB_REF_NAME and GITHUB_REPOSITORY are required')
  }

  const downloadDir = mkdtempSync(path.join(tmpdir(), 'shikin-verify-release-'))

  try {
    const release = JSON.parse(
      execFileSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets'], {
        encoding: 'utf8',
      })
    )
    const assetNames = (release.assets ?? []).map((asset) => asset.name)
    let manifest = null

    if (assetNames.includes('latest.json')) {
      execFileSync(
        'gh',
        [
          'release',
          'download',
          tag,
          '--repo',
          repo,
          '--pattern',
          'latest.json',
          '--dir',
          downloadDir,
        ],
        { encoding: 'utf8' }
      )
      try {
        manifest = JSON.parse(readFileSync(path.join(downloadDir, 'latest.json'), 'utf8'))
      } catch {
        manifest = null
      }
    }

    const { errors } = validateReleaseAssets({
      tag,
      repo,
      isDraft: release.isDraft,
      assetNames,
      manifest,
    })

    if (errors.length > 0) {
      for (const error of errors) {
        fail(error)
      }
      process.exitCode = 1
      return
    }

    console.log('Draft release assets and latest.json passed consistency checks.')
  } finally {
    rmSync(downloadDir, { recursive: true, force: true })
  }
}

export function isDirectExecution(importMetaUrl, entryPoint = process.argv[1]) {
  if (!entryPoint) return false
  return pathToFileURL(path.resolve(entryPoint)).href === importMetaUrl
}

if (isDirectExecution(import.meta.url)) {
  try {
    main()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
