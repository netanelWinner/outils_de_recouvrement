// Affichage des montants, dates, statuts, et saisie de montants.
import { useEffect, useState } from 'react'
import { CHANNELS, CURRENCIES, CURRENCY_LABELS, STATUS_INFO, TONES, type Channel, type Currency, type InvoiceStatus, type Tone } from '@shared/constants'
import { formatMoney, fromMinor, parseAmount } from '@shared/money'
import { formatDate } from '@shared/dates'
import { Mail, MessageCircle, FileText } from 'lucide-react'
import { Input, Select, cx } from './ui'

/** Montant : chiffres en avant, unité (FCFA, USD…) plus petite et discrète. */
export function Money({ minor, currency, className, strong }: { minor: number; currency: Currency; className?: string; strong?: boolean }) {
  return (
    <span className={cx('tabular whitespace-nowrap', strong && 'font-semibold', className)} title={formatMoney(minor, currency)}>
      {formatMoney(minor, currency, false)}
      <span className="ml-[0.25em] text-[0.72em] font-medium tracking-wide opacity-60">{CURRENCY_LABELS[currency]}</span>
    </span>
  )
}

export function DateText({ iso }: { iso: string | null | undefined }) {
  return <span className="tabular whitespace-nowrap">{formatDate(iso)}</span>
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS_INFO[status]
  return (
    <span title={s.help} className={cx('inline-flex cursor-help items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', s.color)}>
      {s.label}
    </span>
  )
}

export function LateBadge({ days }: { days: number }) {
  if (days <= 0) return <span className="text-xs text-slate-400">—</span>
  const tone = days > 90 ? 'bg-red-600 text-white' : days > 60 ? 'bg-red-100 text-red-800' : days > 30 ? 'bg-orange-100 text-orange-800' : 'bg-amber-50 text-amber-800'
  return <span className={cx('tabular rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap', tone)}>{days} j</span>
}

const TONE_COLORS: Record<Tone, string> = {
  courtois: 'bg-sky-50 text-sky-800 ring-sky-200',
  ferme: 'bg-orange-50 text-orange-800 ring-orange-200',
  mise_en_demeure: 'bg-red-50 text-red-800 ring-red-200'
}
export function ToneBadge({ tone }: { tone: Tone | null }) {
  if (!tone) return null
  return <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', TONE_COLORS[tone])}>{TONES[tone]}</span>
}

export function ChannelIcon({ channel, className = 'size-4' }: { channel: Channel; className?: string }) {
  const Icon = channel === 'email' ? Mail : channel === 'whatsapp' ? MessageCircle : FileText
  return (
    <span title={CHANNELS[channel]} className="inline-flex">
      <Icon className={cx(className, channel === 'whatsapp' ? 'text-emerald-600' : channel === 'email' ? 'text-sky-600' : 'text-slate-600')} />
    </span>
  )
}

/** Saisie d'un montant : accepte « 1 250 000 », « 1250000,50 »… Valeur en unité mineure. */
export function AmountInput({
  value,
  currency,
  onChange,
  invalid,
  placeholder = '0'
}: {
  value: number | null
  currency: Currency
  onChange: (minor: number | null) => void
  invalid?: boolean
  placeholder?: string
}) {
  const fmt = (v: number | null) => (v === null ? '' : formatMoney(v, currency, false))
  const [text, setText] = useState(fmt(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setText(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency, focused])
  return (
    <Input
      inputMode="decimal"
      className="tabular text-right"
      invalid={invalid}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        setFocused(true)
        setText(value === null ? '' : String(fromMinor(value, currency)).replace('.', ','))
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseAmount(e.target.value, currency))
      }}
    />
  )
}

export function CurrencySelect({ value, onChange, disabled }: { value: Currency; onChange: (c: Currency) => void; disabled?: boolean }) {
  return (
    <Select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Currency)} className="w-28">
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {CURRENCY_LABELS[c]}
        </option>
      ))}
    </Select>
  )
}

/** Totaux par devise sur une ligne. */
export function MoneyByCurrency({ items, empty = '—' }: { items: { currency: Currency; amount: number }[]; empty?: string }) {
  const list = items.filter((i) => i.amount !== 0)
  if (!list.length) return <span className="text-slate-400">{empty}</span>
  return (
    <span className="tabular inline-flex flex-wrap items-baseline gap-x-1">
      {list.map((i, k) => (
        <span key={i.currency} className="whitespace-nowrap">
          {k > 0 && <span className="mr-1 text-slate-400">+</span>}
          <Money minor={i.amount} currency={i.currency} />
        </span>
      ))}
    </span>
  )
}
