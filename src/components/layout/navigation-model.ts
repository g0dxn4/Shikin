import {
  ArrowLeftRight,
  BarChart3,
  CalendarDays,
  CalendarRange,
  ChartNoAxesCombined,
  CircleDollarSign,
  FileChartColumn,
  Gauge,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListTree,
  PiggyBank,
  Puzzle,
  ReceiptText,
  Settings,
  Tags,
  Target,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'

export type NavigationGroupId =
  | 'overview'
  | 'transactions'
  | 'accounts'
  | 'planning'
  | 'insights'
  | 'settings'

export interface NavigationRoute {
  path: string
  labelKey: string
  fallbackLabel: string
  icon: LucideIcon
}

export interface NavigationGroup {
  id: NavigationGroupId
  labelKey: string
  fallbackLabel: string
  icon: LucideIcon
  homePath: string
  routes: readonly NavigationRoute[]
}

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    id: 'overview',
    labelKey: 'groups.overview',
    fallbackLabel: 'Overview',
    icon: LayoutDashboard,
    homePath: '/',
    routes: [
      { path: '/', labelKey: 'nav.overview', fallbackLabel: 'Overview', icon: LayoutDashboard },
    ],
  },
  {
    id: 'transactions',
    labelKey: 'groups.transactions',
    fallbackLabel: 'Transactions',
    icon: ArrowLeftRight,
    homePath: '/transactions',
    routes: [
      {
        path: '/transactions',
        labelKey: 'nav.transactions',
        fallbackLabel: 'Transactions',
        icon: ReceiptText,
      },
      {
        path: '/categories',
        labelKey: 'nav.categories',
        fallbackLabel: 'Categories',
        icon: Tags,
      },
    ],
  },
  {
    id: 'accounts',
    labelKey: 'groups.accounts',
    fallbackLabel: 'Accounts',
    icon: Landmark,
    homePath: '/accounts',
    routes: [
      { path: '/accounts', labelKey: 'nav.accounts', fallbackLabel: 'Accounts', icon: WalletCards },
      {
        path: '/investments',
        labelKey: 'nav.investments',
        fallbackLabel: 'Investments',
        icon: TrendingUp,
      },
      {
        path: '/receivables',
        labelKey: 'nav.receivables',
        fallbackLabel: 'Receivables',
        icon: HandCoins,
      },
    ],
  },
  {
    id: 'planning',
    labelKey: 'groups.planning',
    fallbackLabel: 'Planning',
    icon: CalendarRange,
    homePath: '/budgets',
    routes: [
      { path: '/budgets', labelKey: 'nav.budgets', fallbackLabel: 'Budgets', icon: PiggyBank },
      { path: '/goals', labelKey: 'nav.goals', fallbackLabel: 'Goals', icon: Target },
      { path: '/bills', labelKey: 'nav.bills', fallbackLabel: 'Bills', icon: ReceiptText },
      {
        path: '/bill-calendar',
        labelKey: 'nav.billCalendar',
        fallbackLabel: 'Bill calendar',
        icon: CalendarDays,
      },
      {
        path: '/debt-payoff',
        labelKey: 'nav.debtPayoff',
        fallbackLabel: 'Debt payoff',
        icon: CircleDollarSign,
      },
      {
        path: '/forecast',
        labelKey: 'nav.forecast',
        fallbackLabel: 'Forecast',
        icon: ChartNoAxesCombined,
      },
    ],
  },
  {
    id: 'insights',
    labelKey: 'groups.insights',
    fallbackLabel: 'Insights',
    icon: BarChart3,
    homePath: '/insights',
    routes: [
      { path: '/insights', labelKey: 'nav.insights', fallbackLabel: 'Insights', icon: Gauge },
      {
        path: '/reports',
        labelKey: 'nav.reports',
        fallbackLabel: 'Reports',
        icon: FileChartColumn,
      },
      {
        path: '/net-worth',
        labelKey: 'nav.netWorth',
        fallbackLabel: 'Net worth',
        icon: TrendingUp,
      },
      {
        path: '/spending-insights',
        labelKey: 'nav.spendingInsights',
        fallbackLabel: 'Spending insights',
        icon: ListTree,
      },
      {
        path: '/spending-heatmap',
        labelKey: 'nav.spendingHeatmap',
        fallbackLabel: 'Spending heatmap',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    id: 'settings',
    labelKey: 'groups.settings',
    fallbackLabel: 'Settings',
    icon: Settings,
    homePath: '/settings',
    routes: [
      {
        path: '/settings',
        labelKey: 'nav.preferences',
        fallbackLabel: 'Preferences',
        icon: Settings,
      },
      {
        path: '/extensions',
        labelKey: 'nav.extensions',
        fallbackLabel: 'Extensions',
        icon: Puzzle,
      },
    ],
  },
] as const

export const NAVIGATION_ROUTES = NAVIGATION_GROUPS.flatMap((group) => group.routes)

export function getNavigationGroup(pathname: string): NavigationGroup {
  return (
    NAVIGATION_GROUPS.find((group) => group.routes.some((route) => route.path === pathname)) ??
    NAVIGATION_GROUPS[0]
  )
}

export function getNavigationRoute(pathname: string): NavigationRoute {
  return NAVIGATION_ROUTES.find((route) => route.path === pathname) ?? NAVIGATION_ROUTES[0]
}
