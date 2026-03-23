import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Undo, Save, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ThemeTokens } from '@/lib/theme'
import { defaultTheme, presetThemes, loadSavedTheme, saveTheme, applyTheme } from '@/lib/theme'

export function ThemeSettings() {
  const { t } = useTranslation('settings')
  type ThemeFilter = 'all' | 'dark' | 'light' | 'editorial' | 'bold'

  const presetFilterByName: Record<string, ThemeFilter[]> = {
    default: ['dark'],
    midnight: ['dark'],
    forest: ['dark'],
    rose: ['light', 'editorial'],
    aurora: ['dark', 'bold'],
    ember: ['dark', 'bold'],
    slate: ['dark'],
    paper: ['light', 'editorial'],
    nord: ['dark'],
    mono: ['dark', 'bold'],
    sunset: ['dark', 'bold', 'editorial'],
    ocean: ['dark', 'bold'],
    matcha: ['dark'],
    terracotta: ['dark', 'editorial'],
    violetGlass: ['dark', 'bold'],
    latte: ['light', 'editorial'],
  }
  const presetLabelByName: Record<string, string> = {
    default: t('theme.presets.default'),
    midnight: t('theme.presets.midnight'),
    forest: t('theme.presets.forest'),
    rose: t('theme.presets.rose'),
    aurora: t('theme.presets.aurora'),
    ember: t('theme.presets.ember'),
    slate: t('theme.presets.slate'),
    paper: t('theme.presets.paper'),
    nord: t('theme.presets.nord'),
    mono: t('theme.presets.mono'),
    sunset: t('theme.presets.sunset'),
    ocean: t('theme.presets.ocean'),
    matcha: t('theme.presets.matcha'),
    terracotta: t('theme.presets.terracotta'),
    violetGlass: t('theme.presets.violetGlass'),
    latte: t('theme.presets.latte'),
  }

  const presetDescriptionByName: Record<string, string> = {
    default: t('theme.presetDescriptions.default'),
    midnight: t('theme.presetDescriptions.midnight'),
    forest: t('theme.presetDescriptions.forest'),
    rose: t('theme.presetDescriptions.rose'),
    aurora: t('theme.presetDescriptions.aurora'),
    ember: t('theme.presetDescriptions.ember'),
    slate: t('theme.presetDescriptions.slate'),
    paper: t('theme.presetDescriptions.paper'),
    nord: t('theme.presetDescriptions.nord'),
    mono: t('theme.presetDescriptions.mono'),
    sunset: t('theme.presetDescriptions.sunset'),
    ocean: t('theme.presetDescriptions.ocean'),
    matcha: t('theme.presetDescriptions.matcha'),
    terracotta: t('theme.presetDescriptions.terracotta'),
    violetGlass: t('theme.presetDescriptions.violetGlass'),
    latte: t('theme.presetDescriptions.latte'),
  }
  const [theme, setTheme] = useState<ThemeTokens>(defaultTheme)

  // Load saved theme asynchronously on mount
  useEffect(() => {
    loadSavedTheme().then((saved) => setTheme(saved))
  }, [])
  const [activeFilter, setActiveFilter] = useState<ThemeFilter>('all')
  const [prefersDark, setPrefersDark] = useState(true)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setPrefersDark(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const featuredPresetNames = useMemo(() => {
    return prefersDark ? ['nord', 'aurora', 'mono'] : ['paper', 'latte', 'rose']
  }, [prefersDark])

  const handleApply = (newTheme: ThemeTokens) => {
    setTheme(newTheme)
    applyTheme(newTheme)
  }

  const handleSave = async () => {
    await saveTheme(theme)
    applyTheme(theme)
    toast.success(t('theme.saveSuccess', 'Theme saved successfully'))
  }

  const handleReset = async () => {
    handleApply(defaultTheme)
    await saveTheme(defaultTheme)
    toast.success(t('theme.resetSuccess', 'Theme reset to default'))
  }

  const handleRevert = async () => {
    const saved = await loadSavedTheme()
    handleApply(saved)
    toast.success(t('theme.revertSuccess', 'Reverted to saved theme'))
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-sm font-semibold">{t('theme.featured.title')}</h3>
          <span className="text-muted-foreground text-[10px] tracking-wide uppercase">
            {prefersDark ? t('theme.featured.darkMode') : t('theme.featured.lightMode')}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">{t('theme.featured.description')}</p>
        <div className="grid gap-3 md:grid-cols-3">
          {featuredPresetNames.map((name) => {
            const preset = presetThemes[name]
            if (!preset) return null
            return (
              <Button
                key={`featured-${name}`}
                variant="outline"
                className="flex h-auto flex-col items-start justify-start gap-2 px-4 py-3"
                onClick={() => handleApply(preset)}
              >
                <span>{presetLabelByName[name] || name}</span>
                <span className="text-muted-foreground text-[11px] font-normal">
                  {presetDescriptionByName[name] || ''}
                </span>
                <div className="flex gap-1">
                  <div
                    className="border-border h-4 w-4 rounded-full border"
                    style={{ background: preset.background }}
                  />
                  <div
                    className="border-border h-4 w-4 rounded-full border"
                    style={{ background: preset.surface }}
                  />
                  <div
                    className="border-border h-4 w-4 rounded-full border"
                    style={{ background: preset.accent }}
                  />
                </div>
              </Button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', t('theme.filters.all') as string],
            ['dark', t('theme.filters.dark') as string],
            ['light', t('theme.filters.light') as string],
            ['editorial', t('theme.filters.editorial') as string],
            ['bold', t('theme.filters.bold') as string],
          ] as const
        ).map(([filter, label]) => (
          <button
            key={filter}
            type="button"
            onClick={() => setActiveFilter(filter)}
            className={[
              'rounded-full border px-3 py-1 font-mono text-[10px] tracking-wide uppercase transition-colors',
              activeFilter === filter
                ? 'bg-accent text-accent-foreground border-accent'
                : 'border-border text-muted-foreground hover:text-foreground hover:border-border-hover',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Object.entries(presetThemes)
          .filter(([name]) => {
            if (activeFilter === 'all') return true
            return (presetFilterByName[name] || []).includes(activeFilter)
          })
          .map(([name, preset]) => (
            <Button
              key={name}
              variant="outline"
              className="flex h-auto flex-col items-start justify-start gap-2 px-4 py-3"
              onClick={() => handleApply(preset)}
            >
              <span>{presetLabelByName[name] || name}</span>
              <span className="text-muted-foreground text-[11px] font-normal">
                {presetDescriptionByName[name] || ''}
              </span>
              <div className="flex gap-1">
                <div
                  className="border-border h-4 w-4 rounded-full border"
                  style={{ background: preset.background }}
                />
                <div
                  className="border-border h-4 w-4 rounded-full border"
                  style={{ background: preset.surface }}
                />
                <div
                  className="border-border h-4 w-4 rounded-full border"
                  style={{ background: preset.accent }}
                />
              </div>
            </Button>
          ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('theme.fields.background')}</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={theme.background}
              onChange={(e) => handleApply({ ...theme, background: e.target.value })}
              className="h-10 w-12 p-1"
            />
            <Input value={theme.background} readOnly className="flex-1" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('theme.fields.surface')}</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={theme.surface}
              onChange={(e) => handleApply({ ...theme, surface: e.target.value })}
              className="h-10 w-12 p-1"
            />
            <Input value={theme.surface} readOnly className="flex-1" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('theme.fields.accent')}</Label>
          <div className="flex gap-2">
            <Input
              type="color"
              value={theme.accent}
              onChange={(e) => handleApply({ ...theme, accent: e.target.value })}
              className="h-10 w-12 p-1"
            />
            <Input value={theme.accent} readOnly className="flex-1" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('theme.fields.radius')}</Label>
          <select
            className="focus:ring-accent border-border h-10 w-full rounded-md border bg-transparent px-3 py-2 focus:ring-2 focus:outline-none"
            value={theme.radiusMd}
            onChange={(e) => handleApply({ ...theme, radiusMd: e.target.value })}
          >
            <option value="0px">{t('theme.options.radius.brutalist')}</option>
            <option value="8px">{t('theme.options.radius.subtle')}</option>
            <option value="12px">{t('theme.options.radius.rounded')}</option>
            <option value="16px">{t('theme.options.radius.pill')}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label>{t('theme.fields.fontPreset')}</Label>
          <select
            className="focus:ring-accent border-border h-10 w-full rounded-md border bg-transparent px-3 py-2 focus:ring-2 focus:outline-none"
            value={theme.fontPreset}
            onChange={(e) =>
              handleApply({
                ...theme,
                fontPreset: e.target.value as 'current' | 'modern' | 'editorial',
              })
            }
          >
            <option value="current">{t('theme.options.font.current')}</option>
            <option value="modern">{t('theme.options.font.modern')}</option>
            <option value="editorial">{t('theme.options.font.editorial')}</option>
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
        <Button variant="ghost" onClick={handleReset}>
          <RotateCcw className="mr-2 h-4 w-4" />
          {t('theme.reset', 'Reset Default')}
        </Button>
        <Button variant="outline" onClick={handleRevert}>
          <Undo className="mr-2 h-4 w-4" />
          {t('theme.revert', 'Revert')}
        </Button>
        <Button onClick={handleSave}>
          <Save className="mr-2 h-4 w-4" />
          {t('theme.save', 'Save Theme')}
        </Button>
      </div>
    </div>
  )
}
