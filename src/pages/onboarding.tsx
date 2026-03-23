import { useState } from 'react'
import { Brain, Shield, TrendingUp, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

const FEATURES = [
  {
    icon: Brain,
    title: 'AI Assistant',
    description:
      'Ivy, your personal finance AI, helps you track spending, manage budgets, and discover insights through natural conversation.',
  },
  {
    icon: Shield,
    title: 'Local-First',
    description:
      'Your financial data never leaves your device. Everything is stored locally with SQLite — no cloud, no compromises.',
  },
  {
    icon: TrendingUp,
    title: 'Smart Insights',
    description:
      'Automatic spending analysis, budget tracking, investment monitoring, and actionable recommendations powered by AI.',
  },
]

const STEPS = [
  { title: 'Welcome', key: 'welcome' },
  { title: 'Setup', key: 'setup' },
  { title: 'Ready', key: 'ready' },
] as const

export function Onboarding() {
  const [step, setStep] = useState(0)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="animate-fade-in-up w-full max-w-lg space-y-10">
        {/* Logo */}
        <div className="text-center">
          <h1 className="font-heading text-5xl font-bold">
            <span className="bg-gradient-to-r from-accent to-[#d17df5] bg-clip-text text-transparent">
              Valute
            </span>
          </h1>
          <p className="text-muted-foreground mt-3 text-base">
            Your AI-powered personal finance manager
          </p>
        </div>

        {/* Feature Cards */}
        {step === 0 && (
          <div className="space-y-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="glass-card flex items-center gap-4 p-5"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                  <feature.icon size={24} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-heading text-sm font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Setup Step */}
        {step === 1 && (
          <div className="glass-card space-y-5 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
              <Shield size={28} className="text-accent" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold">Quick Setup</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                Add your first account and configure your AI provider in Settings.
                Everything stays on your device.
              </p>
            </div>
            <div className="space-y-2 text-left">
              {['Add a bank account', 'Set your currency', 'Configure AI provider'].map(
                (item) => (
                  <div key={item} className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-4 py-2.5">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10">
                      <Check size={10} className="text-muted-foreground" />
                    </div>
                    <span className="text-sm">{item}</span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* Ready Step */}
        {step === 2 && (
          <div className="glass-card space-y-5 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
              <Check size={28} className="text-accent" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold">You're All Set</h3>
              <p className="text-muted-foreground mt-2 text-sm">
                Start tracking your finances, chat with Ivy, and take control of your money.
              </p>
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="mx-auto max-w-md">
          <Button
            className="w-full"
            onClick={() => {
              if (step < STEPS.length - 1) {
                setStep(step + 1)
              }
            }}
          >
            {step === 0 && (
              <>
                Get Started
                <ArrowRight size={16} />
              </>
            )}
            {step === 1 && (
              <>
                Continue
                <ArrowRight size={16} />
              </>
            )}
            {step === 2 && 'Open Valute'}
          </Button>
        </div>

        {/* Step Dots */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStep(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step ? 'w-6 bg-accent' : 'w-2 bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
