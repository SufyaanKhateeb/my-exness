"use client"

import { useUser } from "@auth0/nextjs-auth0/client"
import {
  Bell,
  ChevronDown,
  CircleDollarSign,
  Info,
  LogIn,
  LogOut,
  Plus,
  UserRound,
  X,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useReducer, useTable } from "spacetimedb/react"

import { reducers, tables } from "@/src/module_bindings"
import type { Market } from "@/src/module_bindings/types"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"
import { Badge } from "./ui/badge"
import { Button, buttonVariants } from "./ui/button"
import { Card } from "./ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { Input } from "./ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip"
import { cn } from "@/lib/utils"

type TradingAccountState = {
  auth0UserId: string
  currency: string
  balance: number
  equity: number
  margin: number
  freeMargin: number
  marginLevel: number
  accountLeverage: number
  reservedBalance: number
  availableBalance: number
  unrealizedPnl: number
  netLiquidationValue: number
  updatedAt: { toMillis(): bigint }
}

type PriceAlertState = {
  id: bigint
  auth0UserId: string
  marketId: number
  triggerPrice: number
  referencePriceKind: string
  triggerDirection: string
  status: string
  expiresAt: { toMillis(): bigint }
  triggeredAt: { toMillis(): bigint } | undefined
  triggeredPrice: number | undefined
  createdAt: { toMillis(): bigint }
  updatedAt: { toMillis(): bigint }
}

const FALLBACK_AVATAR = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%234f46e5'/%3E%3Cpath d='M50 45c7.5 0 13.64-6.14 13.64-13.64S57.5 17.72 50 17.72s-13.64 6.14-13.64 13.64S42.5 45 50 45zm0 6.82c-9.09 0-27.28 4.56-27.28 13.64v3.41c0 1.88 1.53 3.41 3.41 3.41h47.74c1.88 0 3.41-1.53 3.41-3.41v-3.41c0-9.08-18.19-13.64-27.28-13.64z' fill='%23fff'/%3E%3C/svg%3E`
const PRICE_ALERT_REFERENCE_BID = "bid"
const PRICE_ALERT_REFERENCE_ASK = "ask"

function formatCurrencyAmount(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

function formatMarginLevel(value: number) {
  if (!Number.isFinite(value)) {
    return "—"
  }

  return `${value.toFixed(2)}%`
}

function formatLeverage(value: number) {
  return `1:${value}`
}

function maskEmail(email: string | undefined | null) {
  if (!email) {
    return "No email available"
  }

  const [local, domain] = email.split("@")

  if (!domain) {
    return email
  }

  if (local.length <= 2) {
    return `${local[0] ?? ""}***@${domain}`
  }

  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`
}

function formatAlertReference(referencePriceKind: string) {
  return referencePriceKind === PRICE_ALERT_REFERENCE_BID ? "Bid" : "Ask"
}

function formatAlertStatus(status: string) {
  if (status === "active") {
    return "Active"
  }

  if (status === "triggered") {
    return "Triggered"
  }

  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatAlertTimestamp(timestamp: { toMillis(): bigint } | undefined) {
  if (!timestamp) {
    return "Pending"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(Number(timestamp.toMillis()))
}

function getAlertStatusVariant(status: string) {
  if (status === "active") {
    return "secondary" as const
  }

  if (status === "triggered") {
    return "default" as const
  }

  return "outline" as const
}

function SignInAnchor({ className, label = "Sign in" }: { className?: string; label?: string }) {
  return (
    <a href="/auth/login" className={cn(buttonVariants({ size: "sm" }), className)}>
      <LogIn className="size-4" />
      {label}
    </a>
  )
}

function SignOutAnchor({ className }: { className?: string }) {
  return (
    <a
      href="/auth/logout"
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "w-full justify-center",
        className
      )}
    >
      <LogOut className="size-4" />
      Sign out
    </a>
  )
}

function AccountSummaryMenu() {
  const { user, isLoading } = useUser()
  const [accountRows, accountReady] = useTable(tables.myTradingAccountState)
  const accountState = (accountRows[0] as TradingAccountState | undefined) ?? null
  const currency = accountState?.currency ?? "USD"

  const metricItems = accountState
    ? [
        {
          label: "Balance",
          description: "Cash balance before unrealized profit or loss from open positions.",
          value: formatCurrencyAmount(accountState.balance, currency),
        },
        {
          label: "Equity",
          description: "Current account value after applying unrealized profit and loss.",
          value: formatCurrencyAmount(accountState.equity, currency),
        },
        {
          label: "Margin",
          description: "Capital currently locked to support open positions and working exposure.",
          value: formatCurrencyAmount(accountState.margin, currency),
        },
        {
          label: "Free margin",
          description: "Remaining available funds that can support new positions or drawdowns.",
          value: formatCurrencyAmount(accountState.freeMargin, currency),
        },
        {
          label: "Margin level",
          description: "Risk buffer expressed as equity divided by used margin, shown as a percentage.",
          value: formatMarginLevel(accountState.marginLevel),
        },
        {
          label: "Account leverage",
          description: "Maximum notional amplification applied when reserving margin for this account.",
          value: formatLeverage(accountState.accountLeverage),
        },
      ]
    : []

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-12 min-w-42.5 justify-between rounded-2xl px-4"
          )}
        >
          <span className="flex items-center gap-2">
            <CircleDollarSign className="size-4 text-primary" />
            <span className="flex flex-col items-start leading-none">
              <span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Equity</span>
              <span className="pt-1 text-sm font-semibold text-foreground">
                {accountState ? formatCurrencyAmount(accountState.equity, currency) : "—"}
              </span>
            </span>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[320px] p-0">
        <div className="p-4">
          <DropdownMenuLabel className="px-0 pb-2 pt-0 text-sm">Account summary</DropdownMenuLabel>

          {!user && !isLoading ? (
            <div className="space-y-3 rounded-xl border border-dashed border-border/70 p-4">
              <p className="text-sm text-muted-foreground">Sign in to load your live equity, margin, and leverage metrics.</p>
              <SignInAnchor label="Sign in to view account" className="w-full" />
            </div>
          ) : !accountReady ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-10 animate-pulse rounded-lg bg-muted/60" />
              ))}
            </div>
          ) : !accountState ? (
            <p className="text-sm text-muted-foreground">No trading account metrics are available yet.</p>
          ) : (
            <div className="space-y-2">
              {metricItems.map(item => (
                <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span>{item.label}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground transition-colors hover:text-foreground">
                          <Info className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">{item.description}</TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PriceAlertsMenu() {
  const { user } = useUser()
  const createPriceAlert = useReducer(reducers.createPriceAlert)
  const deletePriceAlert = useReducer(reducers.deletePriceAlert)
  const [markets] = useTable(tables.market)
  const [alertRows, alertsReady] = useTable(tables.myPriceAlerts)
  const [open, setOpen] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [selectedMarketId, setSelectedMarketId] = useState("")
  const [referencePriceKind, setReferencePriceKind] = useState(PRICE_ALERT_REFERENCE_BID)
  const [expiryDays, setExpiryDays] = useState("1")
  const [triggerPrice, setTriggerPrice] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [deletingAlertId, setDeletingAlertId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedMarketId && markets.length > 0) {
      setSelectedMarketId(String(markets[0].id))
    }
  }, [markets, selectedMarketId])

  const alerts = useMemo(() => {
    return (alertRows as readonly PriceAlertState[]).slice().sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === "active" ? -1 : 1
      }

      return Number(right.createdAt.toMillis() - left.createdAt.toMillis())
    })
  }, [alertRows])

  const marketById = useMemo(() => new Map((markets as readonly Market[]).map(market => [market.id, market])), [markets])
  const activeAlertCount = alerts.filter(alert => alert.status === "active").length

  async function handleCreateAlert() {
    setErrorMessage(null)

    const parsedMarketId = Number(selectedMarketId)
    const parsedTriggerPrice = Number(triggerPrice)
    const parsedExpiryDays = Number(expiryDays)

    if (!Number.isInteger(parsedMarketId) || parsedMarketId <= 0) {
      setErrorMessage("Choose a market.")
      return
    }

    if (!Number.isFinite(parsedTriggerPrice) || parsedTriggerPrice <= 0) {
      setErrorMessage("Enter a valid trigger price.")
      return
    }

    setIsCreating(true)

    try {
      await createPriceAlert({
        marketId: parsedMarketId,
        triggerPrice: parsedTriggerPrice,
        referencePriceKind,
        expiryDays: parsedExpiryDays,
      })

      setTriggerPrice("")
      setExpiryDays("1")
      setReferencePriceKind(PRICE_ALERT_REFERENCE_BID)
      setShowComposer(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create price alert.")
    } finally {
      setIsCreating(false)
    }
  }

  async function handleDeleteAlert(alertId: bigint) {
    setDeletingAlertId(alertId.toString())

    try {
      await deletePriceAlert({ alertId })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete price alert.")
    } finally {
      setDeletingAlertId(null)
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        setShowComposer(false)
        setErrorMessage(null)
      }
    }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-12 rounded-2xl px-4"
          )}
        >
          <Bell className="size-4 text-primary" />
          <span>Price alerts</span>
          {activeAlertCount > 0 ? <Badge variant="secondary">{activeAlertCount}</Badge> : null}
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-95 p-0">
        <div className="p-4">
          <div className="flex items-center justify-between gap-2">
            <DropdownMenuLabel className="px-0 py-0 text-sm">Price alerts</DropdownMenuLabel>
            <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setShowComposer(current => !current)}>
              <Plus className="size-4" />
            </Button>
          </div>

          {!user ? (
            <div className="mt-3 space-y-3 rounded-xl border border-dashed border-border/70 p-4">
              <p className="text-sm text-muted-foreground">Sign in to create alerts and track price triggers across your instruments.</p>
              <SignInAnchor label="Sign in to manage alerts" className="w-full" />
            </div>
          ) : (
            <>
              {showComposer ? (
                <div className="mt-3 space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Select value={selectedMarketId} onValueChange={setSelectedMarketId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Market" />
                      </SelectTrigger>
                      <SelectContent>
                        {(markets as readonly Market[]).map(market => (
                          <SelectItem key={market.id} value={String(market.id)}>
                            {market.symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={referencePriceKind} onValueChange={setReferencePriceKind}>
                      <SelectTrigger>
                        <SelectValue placeholder="Reference" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={PRICE_ALERT_REFERENCE_BID}>Bid</SelectItem>
                        <SelectItem value={PRICE_ALERT_REFERENCE_ASK}>Ask</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <Input
                      value={triggerPrice}
                      onChange={event => setTriggerPrice(event.target.value)}
                      inputMode="decimal"
                      placeholder="Trigger price"
                    />
                    <Select value={expiryDays} onValueChange={setExpiryDays}>
                      <SelectTrigger>
                        <SelectValue placeholder="Expiry" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 day</SelectItem>
                        <SelectItem value="5">5 days</SelectItem>
                        <SelectItem value="15">15 days</SelectItem>
                        <SelectItem value="30">30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowComposer(false)}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" onClick={handleCreateAlert} disabled={isCreating}>
                      {isCreating ? "Adding..." : "Add alert"}
                    </Button>
                  </div>
                </div>
              ) : null}

              <DropdownMenuSeparator className="my-3" />

              {!alertsReady ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="h-20 animate-pulse rounded-xl bg-muted/60" />
                  ))}
                </div>
              ) : alerts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  No price alerts yet. Use the plus button to add one.
                </div>
              ) : (
                <div className="max-h-90 space-y-2 overflow-y-auto pr-1">
                  {alerts.map(alert => {
                    const market = marketById.get(alert.marketId)

                    return (
                      <div key={alert.id.toString()} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{market?.symbol ?? `Market ${alert.marketId}`}</p>
                              <Badge variant={getAlertStatusVariant(alert.status)}>{formatAlertStatus(alert.status)}</Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {formatAlertReference(alert.referencePriceKind)} trigger at {alert.triggerPrice.toFixed(2)}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Expires {formatAlertTimestamp(alert.expiresAt)}
                            </p>
                            {alert.triggeredAt ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Triggered {formatAlertTimestamp(alert.triggeredAt)}
                                {typeof alert.triggeredPrice === "number" ? ` at ${alert.triggeredPrice.toFixed(2)}` : ""}
                              </p>
                            ) : null}
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0 text-muted-foreground"
                            disabled={deletingAlertId === alert.id.toString()}
                            onClick={() => void handleDeleteAlert(alert.id)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu() {
  const { user, isLoading } = useUser()

  if (isLoading) {
    return <div className="h-12 w-31 animate-pulse rounded-2xl border border-border/70 bg-muted/50" />
  }

  if (!user) {
    return <SignInAnchor />
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-12 rounded-2xl px-3"
          )}
        >
          <Avatar className="size-8 border border-border/70">
            <AvatarImage src={user.picture || FALLBACK_AVATAR} alt={user.name || "User"} referrerPolicy="no-referrer" />
            <AvatarFallback>
              <UserRound className="size-4" />
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium md:inline">{user.name ?? "Account"}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-70 p-0">
        <div className="p-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-12 border border-border/70">
              <AvatarImage src={user.picture || FALLBACK_AVATAR} alt={user.name || "User"} referrerPolicy="no-referrer" />
              <AvatarFallback>
                <UserRound className="size-5" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{user.name ?? "Authenticated user"}</p>
              <p className="truncate text-xs text-muted-foreground">{maskEmail(user.email)}</p>
            </div>
          </div>

          <DropdownMenuSeparator className="my-3" />

          <div className="space-y-2 text-sm">
            {user.nickname ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Nickname</span>
                <span className="truncate font-medium text-foreground">{user.nickname}</span>
              </div>
            ) : null}
            {user.email ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Email</span>
                <span className="truncate font-medium text-foreground">{maskEmail(user.email)}</span>
              </div>
            ) : null}
            {typeof user.email_verified === "boolean" ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Verification</span>
                <Badge variant={user.email_verified ? "default" : "outline"}>
                  {user.email_verified ? "Verified" : "Unverified"}
                </Badge>
              </div>
            ) : null}
          </div>

          <DropdownMenuSeparator className="my-3" />

          <SignOutAnchor />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default function AppHeader() {
  return (
    <Card className="rounded-none border-border/70 px-4 py-2 shadow-sm md:px-5 md:py-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 items-center rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 text-sm font-semibold uppercase tracking-[0.24em] text-foreground">
            my-exness
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <AccountSummaryMenu />
          <PriceAlertsMenu />
          <UserMenu />
        </div>
      </div>
    </Card>
  )
}