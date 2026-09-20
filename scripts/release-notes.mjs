#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const changelogPath = path.join(rootDir, 'CHANGELOG.md')

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeChangelog(changelog) {
  return String(changelog ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

export function extractReleaseNotes(changelog, tagOrVersion) {
  const version = normalizeReleaseVersion(tagOrVersion)
  const markdown = normalizeChangelog(changelog)
  const headingPattern = new RegExp(
    `^##[ \\t]+\\[v?${escapeRegExp(version)}\\](?:[ \\t]+-[ \\t]+\\d{4}-\\d{2}-\\d{2})?[ \\t]*$`,
    'm'
  )
  const headingMatch = headingPattern.exec(markdown)

  if (!headingMatch) {
    throw new Error(`CHANGELOG.md has no section for version ${version}`)
  }

  const sectionStart = headingMatch.index + headingMatch[0].length
  const rest = markdown.slice(sectionStart)
  const nextHeading = rest.search(/^##[ \t]+/m)
  const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim()

  if (!body) {
    throw new Error(`CHANGELOG.md section for version ${version} is empty`)
  }

  return body
}

function createOutputDelimiter() {
  return `ghadelim_${randomBytes(16).toString('hex')}`
}

export function writeGitHubOutput(
  outputPath,
  name,
  value,
  createDelimiter = createOutputDelimiter
) {
  if (!outputPath) {
    throw new Error('GITHUB_OUTPUT path is required')
  }

  if (!name) {
    throw new Error('GitHub Actions output name is required')
  }

  const body = String(value ?? '')
  let delimiter = createDelimiter()
  let attempts = 0

  while (body.includes(delimiter)) {
    attempts += 1
    if (attempts > 5) {
      throw new Error('Could not generate a unique GITHUB_OUTPUT delimiter')
    }
    delimiter = createDelimiter()
  }

  appendFileSync(outputPath, `${name}<<${delimiter}\n${body}\n${delimiter}\n`)
  return delimiter
}

async function main() {
  const tagOrVersion = process.argv[2] || process.env.GITHUB_REF_NAME
  const version = normalizeReleaseVersion(tagOrVersion)
  const changelog = await readFile(changelogPath, 'utf8')
  const body = extractReleaseNotes(changelog, version)
  const outputPath = process.env.GITHUB_OUTPUT

  if (outputPath) {
    writeGitHubOutput(outputPath, 'body', body)
    console.log(`Extracted release notes for ${version}`)
    return
  }

  process.stdout.write(`${body}\n`)
}

export function isDirectExecution(importMetaUrl, entryPoint = process.argv[1]) {
  if (!entryPoint) return false
  return pathToFileURL(path.resolve(entryPoint)).href === importMetaUrl
}

if (isDirectExecution(import.meta.url)) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
