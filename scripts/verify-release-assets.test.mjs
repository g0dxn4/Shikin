// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parseReleaseAssetUrl, validateReleaseAssets } from './verify-release-assets.mjs'

const TAG = 'v1.0.10'
const REPO = 'g0dxn4/Shikin'

function platformUrl(filename) {
  return `https://github.com/${REPO}/releases/download/${TAG}/${filename}`
}

function platform(filename) {
  return {
    signature: 'dW50cnVzdGVk-signature',
    url: platformUrl(filename),
  }
}

const defaultPlatforms = {
  'darwin-aarch64': platform('Shikin_aarch64.app.tar.gz'),
  'darwin-x86_64': platform('Shikin_x64.app.tar.gz'),
  'linux-x86_64': platform('Shikin_1.0.10_amd64.AppImage'),
  'windows-x86_64': platform('Shikin_1.0.10_x64_en-US.msi'),
}

const aliasPlatforms = {
  'darwin-aarch64-app': platform('Shikin_aarch64.app.tar.gz'),
  'darwin-x86_64-app': platform('Shikin_x64.app.tar.gz'),
  'linux-x86_64-appimage': platform('Shikin_1.0.10_amd64.AppImage'),
  'linux-x86_64-deb': platform('Shikin_1.0.10_amd64.deb'),
  'linux-x86_64-rpm': platform('Shikin-1.0.10-1.x86_64.rpm'),
  'windows-x86_64-msi': platform('Shikin_1.0.10_x64_en-US.msi'),
  'windows-x86_64-nsis': platform('Shikin_1.0.10_x64-setup.exe'),
}

function assetsFromPlatforms(platforms) {
  const names = new Set([
    'latest.json',
    `shikin-cli-source-${TAG}.tar.gz`,
    `shikin-cli-source-${TAG}.tar.gz.sha256`,
  ])

  for (const entry of Object.values(platforms)) {
    const filename = entry.url.split('/').pop()
    names.add(filename)
    names.add(`${filename}.sig`)
  }

  return [...names]
}

function validRelease({
  platforms = { ...defaultPlatforms, ...aliasPlatforms },
  manifest = {},
  assetNames,
  ...rest
} = {}) {
  return {
    tag: TAG,
    repo: REPO,
    isDraft: true,
    assetNames: assetNames ?? assetsFromPlatforms(platforms),
    ...rest,
    manifest:
      manifest == null
        ? null
        : {
            version: '1.0.10',
            notes: 'See the assets below to download and install this version.',
            pub_date: '2026-05-19T02:40:59.830Z',
            platforms,
            ...manifest,
          },
  }
}

describe('parseReleaseAssetUrl', () => {
  it('accepts a same-repo HTTPS download URL even when the filename has no version', () => {
    expect(
      parseReleaseAssetUrl(platformUrl('Shikin_aarch64.app.tar.gz'), { repo: REPO, tag: TAG })
    ).toEqual({ filename: 'Shikin_aarch64.app.tar.gz' })
  })

  it('rejects a foreign host or repository', () => {
    expect(
      parseReleaseAssetUrl('https://evil.example/Shikin_aarch64.app.tar.gz', {
        repo: REPO,
        tag: TAG,
      }).error
    ).toMatch(/github.com/)
    expect(
      parseReleaseAssetUrl(
        'https://github.com/evil/Shikin/releases/download/v1.0.10/Shikin_aarch64.app.tar.gz',
        { repo: REPO, tag: TAG }
      ).error
    ).toMatch(/g0dxn4\/Shikin tag v1\.0\.10/)
  })
})

describe('validateReleaseAssets', () => {
  it('accepts the four default updater targets plus known aliases', () => {
    expect(validateReleaseAssets(validRelease())).toEqual({ errors: [] })
  })

  it('accepts only the four required platforms when aliases are absent', () => {
    expect(validateReleaseAssets(validRelease({ platforms: defaultPlatforms }))).toEqual({
      errors: [],
    })
  })

  it('fails when a required platform is missing even if an alias exists', () => {
    const platforms = { ...defaultPlatforms, ...aliasPlatforms }
    delete platforms['linux-x86_64']

    expect(validateReleaseAssets(validRelease({ platforms })).errors).toContain(
      'latest.json is missing required platform: linux-x86_64'
    )
  })

  it('fails when latest.json version does not match the tag without a v prefix', () => {
    const withV = validateReleaseAssets(validRelease({ manifest: { version: 'v1.0.10' } }))
    const otherVersion = validateReleaseAssets(validRelease({ manifest: { version: '1.0.11' } }))

    expect(withV.errors).toContain(
      'latest.json version "v1.0.10" does not match tag version "1.0.10"'
    )
    expect(otherVersion.errors).toContain(
      'latest.json version "1.0.11" does not match tag version "1.0.10"'
    )
  })

  it('fails when a provided platform URL is foreign or uses HTTP', () => {
    const foreign = validateReleaseAssets(
      validRelease({
        platforms: {
          ...defaultPlatforms,
          'darwin-aarch64': {
            signature: 'dW50cnVzdGVk-signature',
            url: 'https://github.com/evil/other/releases/download/v1.0.10/Shikin_aarch64.app.tar.gz',
          },
        },
      })
    )
    const http = validateReleaseAssets(
      validRelease({
        platforms: {
          ...defaultPlatforms,
          'windows-x86_64': {
            signature: 'dW50cnVzdGVk-signature',
            url: 'http://github.com/g0dxn4/Shikin/releases/download/v1.0.10/Shikin_1.0.10_x64_en-US.msi',
          },
        },
      })
    )

    expect(foreign.errors.some((error) => error.includes('evil/other'))).toBe(true)
    expect(http.errors.some((error) => error.includes('must use HTTPS'))).toBe(true)
  })

  it('rejects a non-default port on an otherwise matching GitHub URL', () => {
    const result = parseReleaseAssetUrl(
      platformUrl('Shikin_x64.app.tar.gz').replace('github.com/', 'github.com:8443/'),
      { repo: REPO, tag: TAG }
    )
    expect(result.error).toContain('must be on github.com')
  })

  it('fails when a platform URL points at an asset that was not uploaded', () => {
    const result = validateReleaseAssets(
      validRelease({
        platforms: {
          ...defaultPlatforms,
          'darwin-x86_64': platform('Shikin_missing.app.tar.gz'),
        },
        assetNames: assetsFromPlatforms(defaultPlatforms),
      })
    )

    expect(result.errors).toContain(
      'latest.json platforms.darwin-x86_64 URL points at missing uploaded asset: Shikin_missing.app.tar.gz'
    )
  })

  it('fails when a signature field or matching .sig asset is missing', () => {
    const emptySignature = validateReleaseAssets(
      validRelease({
        platforms: {
          ...defaultPlatforms,
          'darwin-aarch64': {
            signature: '   ',
            url: platformUrl('Shikin_aarch64.app.tar.gz'),
          },
        },
      })
    )
    const assetNames = assetsFromPlatforms(defaultPlatforms).filter(
      (name) => name !== 'Shikin_x64.app.tar.gz.sig'
    )
    const missingSigFile = validateReleaseAssets(
      validRelease({
        platforms: defaultPlatforms,
        assetNames,
      })
    )

    expect(emptySignature.errors).toContain(
      'latest.json platforms.darwin-aarch64 is missing a non-empty signature'
    )
    expect(missingSigFile.errors).toContain(
      'latest.json platforms.darwin-x86_64 is missing uploaded signature asset: Shikin_x64.app.tar.gz.sig'
    )
  })

  it('fails when the release is not a draft', () => {
    expect(validateReleaseAssets(validRelease({ isDraft: false })).errors).toContain(
      'Release is already published before finalization step.'
    )
  })

  it('preserves draft latest.json and CLI source archive presence checks', () => {
    const result = validateReleaseAssets(
      validRelease({
        assetNames: ['Shikin_aarch64.app.tar.gz'],
        manifest: null,
      })
    )

    expect(result.errors).toContain(
      'Missing expected release assets before publish: latest.json, shikin-cli-source-v1.0.10.tar.gz, shikin-cli-source-v1.0.10.tar.gz.sha256'
    )
  })

  it('validates alias entries, not only the four default keys', () => {
    const result = validateReleaseAssets(
      validRelease({
        platforms: {
          ...defaultPlatforms,
          ...aliasPlatforms,
          'linux-x86_64-deb': {
            signature: 'dW50cnVzdGVk-signature',
            url: 'https://github.com/someone-else/Shikin/releases/download/v1.0.10/Shikin_1.0.10_amd64.deb',
          },
        },
      })
    )

    expect(result.errors.some((error) => error.includes('linux-x86_64-deb'))).toBe(true)
  })
})
