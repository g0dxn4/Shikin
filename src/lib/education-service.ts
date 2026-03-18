export type EducationTopic = 'budgeting' | 'saving' | 'investing' | 'debt' | 'general'

export interface EducationTip {
  id: string
  topic: EducationTopic
  title: string
  content: string
  learnMore?: string
}

const tips: EducationTip[] = [
  // Budgeting
  {
    id: 'budget-50-30-20',
    topic: 'budgeting',
    title: 'The 50/30/20 Rule',
    content:
      'A popular budgeting framework suggests allocating 50% of after-tax income to needs, 30% to wants, and 20% to savings and debt repayment. This can serve as a useful starting point for structuring a budget.',
    learnMore: 'https://www.investopedia.com/ask/answers/022916/what-502030-budget-rule.asp',
  },
  {
    id: 'budget-zero-based',
    topic: 'budgeting',
    title: 'Zero-Based Budgeting',
    content:
      'Zero-based budgeting assigns every dollar of income a specific purpose, so income minus expenses equals zero. This approach can help ensure no money goes unaccounted for and encourages intentional spending decisions.',
    learnMore: 'https://www.investopedia.com/terms/z/zbb.asp',
  },
  {
    id: 'budget-envelope',
    topic: 'budgeting',
    title: 'The Envelope Method',
    content:
      'The envelope method involves dividing cash into envelopes for each spending category. When an envelope is empty, spending in that category stops. Digital versions of this concept work the same way with virtual categories.',
    learnMore: 'https://www.investopedia.com/envelope-budgeting-system-5208026',
  },

  // Saving
  {
    id: 'saving-emergency-fund',
    topic: 'saving',
    title: 'Emergency Fund Basics',
    content:
      'Financial educators commonly suggest keeping 3 to 6 months of essential expenses in an easily accessible savings account. This fund is designed to cover unexpected events like medical bills, car repairs, or job loss without going into debt.',
    learnMore: 'https://www.investopedia.com/terms/e/emergency_fund.asp',
  },
  {
    id: 'saving-compound-interest',
    topic: 'saving',
    title: 'The Power of Compound Interest',
    content:
      'Compound interest means earning interest on both the original amount and previously earned interest. Over long periods, this effect can significantly accelerate savings growth, which is why starting early is often emphasized.',
    learnMore: 'https://www.investopedia.com/terms/c/compoundinterest.asp',
  },
  {
    id: 'saving-pay-yourself-first',
    topic: 'saving',
    title: 'Pay Yourself First',
    content:
      'This concept involves setting aside savings as soon as income is received, before paying bills or discretionary spending. Automating transfers to a savings account on payday can help make this a consistent habit.',
    learnMore: 'https://www.investopedia.com/terms/p/payyourselffirst.asp',
  },

  // Investing
  {
    id: 'investing-dca',
    topic: 'investing',
    title: 'Dollar-Cost Averaging',
    content:
      'Dollar-cost averaging involves investing a fixed amount at regular intervals regardless of market conditions. This strategy can reduce the impact of volatility by purchasing more shares when prices are low and fewer when prices are high.',
    learnMore: 'https://www.investopedia.com/terms/d/dollarcostaveraging.asp',
  },
  {
    id: 'investing-diversification',
    topic: 'investing',
    title: 'Diversification',
    content:
      'Diversification means spreading investments across different asset classes, sectors, and geographies. The idea is that losses in one area may be offset by gains in another, potentially reducing overall portfolio risk.',
    learnMore: 'https://www.investopedia.com/terms/d/diversification.asp',
  },
  {
    id: 'investing-index-vs-active',
    topic: 'investing',
    title: 'Index Funds vs. Active Management',
    content:
      'Index funds aim to match the performance of a market index at low cost, while actively managed funds try to outperform through stock selection. Research has shown that most actively managed funds underperform their benchmark index over the long term.',
    learnMore: 'https://www.investopedia.com/ask/answers/040315/what-difference-between-index-fund-and-actively-managed-fund.asp',
  },

  // Debt
  {
    id: 'debt-snowball-vs-avalanche',
    topic: 'debt',
    title: 'Snowball vs. Avalanche Method',
    content:
      'The debt snowball method focuses on paying off the smallest balances first for psychological motivation, while the avalanche method targets the highest interest rates first to minimize total interest paid. Both approaches can be effective depending on individual preferences.',
    learnMore: 'https://www.investopedia.com/articles/personal-finance/080716/debt-avalanche-vs-debt-snowball-which-best-you.asp',
  },
  {
    id: 'debt-good-vs-bad',
    topic: 'debt',
    title: 'Good Debt vs. Bad Debt',
    content:
      'Some financial educators distinguish between debt used to acquire appreciating assets (like education or real estate) and debt used for depreciating purchases (like consumer goods). Understanding this distinction can help inform borrowing decisions.',
    learnMore: 'https://www.investopedia.com/articles/pf/12/good-debt-bad-debt.asp',
  },
  {
    id: 'debt-credit-utilization',
    topic: 'debt',
    title: 'Credit Utilization Ratio',
    content:
      'Credit utilization is the percentage of available credit being used. Keeping this ratio below 30% is generally considered favorable for credit scores. Lower utilization signals to lenders that credit is being managed responsibly.',
    learnMore: 'https://www.investopedia.com/terms/c/credit-utilization-rate.asp',
  },

  // General
  {
    id: 'general-inflation',
    topic: 'general',
    title: 'Understanding Inflation',
    content:
      'Inflation is the gradual increase in prices over time, which reduces the purchasing power of money. This is why savings held in cash may lose real value, and why many people consider investing to potentially outpace inflation over the long term.',
    learnMore: 'https://www.investopedia.com/terms/i/inflation.asp',
  },
  {
    id: 'general-opportunity-cost',
    topic: 'general',
    title: 'Opportunity Cost',
    content:
      'Opportunity cost is the value of the next best alternative that is given up when making a choice. Every financial decision has a trade-off, and considering what you are giving up can lead to more informed spending and investing choices.',
    learnMore: 'https://www.investopedia.com/terms/o/opportunitycost.asp',
  },
  {
    id: 'general-time-value',
    topic: 'general',
    title: 'Time Value of Money',
    content:
      'A dollar today is generally worth more than a dollar in the future because of its potential to earn returns. This foundational concept explains why early saving and investing is often emphasized, as time allows money to grow through compounding.',
    learnMore: 'https://www.investopedia.com/terms/t/timevalueofmoney.asp',
  },
]

const actionToTipMap: Record<string, string> = {
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

/**
 * Get a contextual financial education tip based on a topic or keyword.
 */
export function getContextualTip(context: string): EducationTip | null {
  const lower = context.toLowerCase()

  // Try exact topic match
  const topicMatch = tips.filter((tip) => tip.topic === lower)
  if (topicMatch.length > 0) {
    return topicMatch[Math.floor(Math.random() * topicMatch.length)]
  }

  // Try keyword matching
  for (const tip of tips) {
    if (
      tip.title.toLowerCase().includes(lower) ||
      tip.content.toLowerCase().includes(lower) ||
      tip.id.includes(lower)
    ) {
      return tip
    }
  }

  // Fallback: return a random tip
  return tips[Math.floor(Math.random() * tips.length)]
}

/**
 * Map a user action to a relevant educational tip.
 */
export function getTipForAction(action: string): EducationTip | null {
  const tipId = actionToTipMap[action]
  if (!tipId) return null
  return tips.find((tip) => tip.id === tipId) ?? null
}

/**
 * Get the daily tip based on the current date.
 * Rotates through all tips, one per day.
 */
export function getDailyTip(): EducationTip {
  const today = new Date()
  const dayOfYear = Math.floor(
    (today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000
  )
  return tips[dayOfYear % tips.length]
}

/**
 * Get all tips for a specific topic.
 */
export function getTipsByTopic(topic: EducationTopic): EducationTip[] {
  return tips.filter((tip) => tip.topic === topic)
}

/**
 * Get all available tips.
 */
export function getAllTips(): EducationTip[] {
  return [...tips]
}
