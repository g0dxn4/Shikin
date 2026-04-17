export type EducationTopic = 'budgeting' | 'saving' | 'investing' | 'debt' | 'general'

export type EducationTip = {
  id: string
  topic: EducationTopic
  title: string
  content: string
  learnMore?: string
}

export const EDUCATION_TIPS: EducationTip[] = [
  {
    id: 'budget-50-30-20',
    topic: 'budgeting',
    title: 'The 50/30/20 Rule',
    content:
      'A common starting point is 50% of after-tax income for needs, 30% for wants, and 20% for savings or debt repayment.',
    learnMore: 'https://www.investopedia.com/ask/answers/022916/what-502030-budget-rule.asp',
  },
  {
    id: 'budget-zero-based',
    topic: 'budgeting',
    title: 'Zero-Based Budgeting',
    content:
      'Zero-based budgeting assigns every dollar of income a job so income minus planned spending equals zero.',
    learnMore: 'https://www.investopedia.com/terms/z/zbb.asp',
  },
  {
    id: 'budget-envelope',
    topic: 'budgeting',
    title: 'The Envelope Method',
    content:
      'The envelope method limits each spending category to a fixed amount so overspending becomes obvious quickly.',
    learnMore: 'https://www.investopedia.com/envelope-budgeting-system-5208026',
  },
  {
    id: 'saving-emergency-fund',
    topic: 'saving',
    title: 'Emergency Fund Basics',
    content:
      'Many people aim for 3 to 6 months of essential expenses in an easily accessible savings account.',
    learnMore: 'https://www.investopedia.com/terms/e/emergency_fund.asp',
  },
  {
    id: 'saving-compound-interest',
    topic: 'saving',
    title: 'The Power of Compound Interest',
    content:
      'Compound interest means returns can themselves earn returns, which makes time especially valuable.',
    learnMore: 'https://www.investopedia.com/terms/c/compoundinterest.asp',
  },
  {
    id: 'saving-pay-yourself-first',
    topic: 'saving',
    title: 'Pay Yourself First',
    content:
      'Saving immediately after income arrives can make progress more consistent than saving whatever remains later.',
    learnMore: 'https://www.investopedia.com/terms/p/payyourselffirst.asp',
  },
  {
    id: 'investing-dca',
    topic: 'investing',
    title: 'Dollar-Cost Averaging',
    content:
      'Investing a fixed amount on a regular schedule can reduce the emotional pressure of timing the market.',
    learnMore: 'https://www.investopedia.com/terms/d/dollarcostaveraging.asp',
  },
  {
    id: 'investing-diversification',
    topic: 'investing',
    title: 'Diversification',
    content:
      'Diversification spreads risk across assets, sectors, or geographies so one position matters less.',
    learnMore: 'https://www.investopedia.com/terms/d/diversification.asp',
  },
  {
    id: 'investing-index-vs-active',
    topic: 'investing',
    title: 'Index Funds vs. Active Management',
    content:
      'Index funds aim to match a benchmark at low cost, while active funds try to outperform through security selection.',
    learnMore:
      'https://www.investopedia.com/ask/answers/040315/what-difference-between-index-fund-and-actively-managed-fund.asp',
  },
  {
    id: 'debt-snowball-vs-avalanche',
    topic: 'debt',
    title: 'Snowball vs. Avalanche Method',
    content:
      'Snowball targets the smallest balances first, while avalanche prioritizes the highest interest rates first.',
    learnMore:
      'https://www.investopedia.com/articles/personal-finance/080716/debt-avalanche-vs-debt-snowball-which-best-you.asp',
  },
  {
    id: 'debt-good-vs-bad',
    topic: 'debt',
    title: 'Good Debt vs. Bad Debt',
    content:
      'Debt used to acquire appreciating assets is often viewed differently from debt used for short-lived consumption.',
    learnMore: 'https://www.investopedia.com/articles/pf/12/good-debt-bad-debt.asp',
  },
  {
    id: 'debt-credit-utilization',
    topic: 'debt',
    title: 'Credit Utilization Ratio',
    content:
      'Keeping revolving balances low relative to total credit limits is generally healthier for credit profiles.',
    learnMore: 'https://www.investopedia.com/terms/c/credit-utilization-rate.asp',
  },
  {
    id: 'general-inflation',
    topic: 'general',
    title: 'Understanding Inflation',
    content:
      'Inflation reduces the purchasing power of cash over time, which is why long-term goals often need growth assets.',
    learnMore: 'https://www.investopedia.com/terms/i/inflation.asp',
  },
  {
    id: 'general-opportunity-cost',
    topic: 'general',
    title: 'Opportunity Cost',
    content:
      'Every financial choice trades away an alternative, so good decisions consider what is being given up too.',
    learnMore: 'https://www.investopedia.com/terms/o/opportunitycost.asp',
  },
  {
    id: 'general-time-value',
    topic: 'general',
    title: 'Time Value of Money',
    content:
      'Money available today is more valuable than the same amount later because it can be used or invested immediately.',
    learnMore: 'https://www.investopedia.com/terms/t/timevalueofmoney.asp',
  },
]

export const ACTION_TO_TIP: Record<string, string> = {
  'first-budget': 'budget-50-30-20',
  'create-budget': 'budget-zero-based',
  'first-investment': 'investing-dca',
  'add-investment': 'investing-diversification',
  'first-transaction': 'saving-pay-yourself-first',
  'credit-card-payment': 'debt-credit-utilization',
  'debt-payment': 'debt-snowball-vs-avalanche',
  'savings-deposit': 'saving-compound-interest',
  'view-spending': 'budget-envelope',
  'emergency-fund': 'saving-emergency-fund',
  'view-net-worth': 'general-inflation',
}

export function getDailyEducationTip(): EducationTip {
  const today = new Date()
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  )
  return EDUCATION_TIPS[dayOfYear % EDUCATION_TIPS.length]
}
