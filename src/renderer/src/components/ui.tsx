// Composants d'interface de base (boutons, champs, cartes, fenêtres…), style sobre et lisible.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle, Loader2, MoreHorizontal, X } from 'lucide-react'
import { GLOSSARY, type GlossaryKey } from '@shared/glossary'

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        VARIANTS[variant],
        className
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

const fieldBase =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-slate-100 disabled:text-slate-500'
/** Pleine largeur par défaut, sauf si une largeur (w-…) est fournie. */
const width = (className?: string) => (className && /(^|\s)w-/.test(className) ? '' : 'w-full')

export function Input({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input {...rest} className={cx(fieldBase, width(className), invalid && 'border-red-400 focus:border-red-500 focus:ring-red-500/20', className)} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(fieldBase, width(className), 'min-h-20', className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(fieldBase, width(className), 'pr-8', className)}>
      {children}
    </select>
  )
}

export function Checkbox({ label, checked, onChange, help }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {help && <span className="block text-xs text-slate-500">{help}</span>}
      </span>
    </label>
  )
}

/** Libellé + champ + aide + erreur. */
export function Field({
  label,
  required,
  help,
  error,
  tip,
  children,
  className
}: {
  label: ReactNode
  required?: boolean
  help?: ReactNode
  error?: string | null
  tip?: GlossaryKey
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500">*</span>}
        {tip && <HelpTip k={tip} />}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : help ? <p className="mt-1 text-xs text-slate-500">{help}</p> : null}
    </div>
  )
}

/** Infobulle d'explication (glossaire ou texte libre). */
export function HelpTip({ k, text }: { k?: GlossaryKey; text?: string }) {
  const [open, setOpen] = useState(false)
  const content = k ? GLOSSARY[k] : null
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <HelpCircle className="size-3.5 cursor-help text-slate-400 hover:text-brand-700" aria-label="Aide" />
      {open && (
        <span className="absolute left-1/2 top-5 z-50 w-72 -translate-x-1/2 rounded-lg bg-slate-900 p-3 text-xs font-normal leading-relaxed text-white shadow-xl">
          {content && <b className="mb-1 block text-brand-100">{content.term}</b>}
          {content ? content.def : text}
        </span>
      )}
    </span>
  )
}

/**
 * Texte sur une ligne qui réduit sa taille de police jusqu'à tenir dans la largeur disponible
 * (montants de plusieurs milliards dans une petite carte). En dernier recours, passe à la ligne.
 */
export function FitText({ children, className, min = 13 }: { children: ReactNode; className?: string; min?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.fontSize = ''
      el.style.whiteSpace = 'nowrap'
      let size = parseFloat(getComputedStyle(el).fontSize)
      while (el.scrollWidth > el.clientWidth + 1 && size > min) {
        size -= 1
        el.style.fontSize = `${size}px`
      }
      if (el.scrollWidth > el.clientWidth + 1) el.style.whiteSpace = 'normal'
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  })
  return (
    <div ref={ref} className={cx('min-w-0 overflow-hidden whitespace-nowrap', className)}>
      {children}
    </div>
  )
}

export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, sub, tone = 'default', tip, onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'danger' | 'success' | 'warning'; tip?: GlossaryKey; onClick?: () => void }) {
  const tones = { default: 'text-slate-900', danger: 'text-red-700', success: 'text-emerald-700', warning: 'text-amber-700' }
  return (
    <div
      onClick={onClick}
      className={cx(
        'flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm',
        onClick && 'cursor-pointer transition hover:border-brand-600 hover:shadow'
      )}
    >
      <div className="flex min-h-8 items-start gap-1 text-[11px] leading-tight font-semibold tracking-wider text-slate-500 uppercase">
        <span className="min-w-0">{label}</span>
        {tip && <HelpTip k={tip} />}
      </div>
      {/* La police se réduit automatiquement si le montant est trop long pour la carte */}
      <FitText className={cx('mt-1 text-lg leading-snug font-semibold 2xl:text-[1.375rem]', tones[tone])}>{value}</FitText>
      {sub && <div className="mt-auto pt-1 text-xs leading-snug text-slate-500">{sub}</div>}
    </div>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', className ?? 'bg-slate-100 text-slate-700 ring-slate-300')}>
      {children}
    </span>
  )
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  )
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="font-medium text-slate-700">{title}</p>
      {text && <p className="mt-1 max-w-md text-sm text-slate-500">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Alert({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900'
  }
  return (
    <div className={cx('flex items-start gap-3 rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

/** Fenêtre modale. Échap ferme (sauf si `locked`). */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  side = false
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  side?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }
  return createPortal(
    <div className={cx('fixed inset-0 z-40 flex bg-slate-900/40', side ? 'justify-end' : 'items-start justify-center overflow-y-auto p-6 pt-[6vh]')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className={cx('flex w-full flex-col bg-white shadow-2xl', side ? 'h-full max-w-3xl' : cx('rounded-xl', widths[size], 'max-h-[88vh]'))}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="Fermer">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 rounded-b-xl">{footer}</footer>}
      </div>
    </div>,
    document.body
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-x-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.key ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-800'
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Menu d'actions secondaires (bouton « Autres actions »). */
export function ActionMenu({ label = 'Autres actions', items }: { label?: string; items: { label: string; icon?: ReactNode; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <Button onClick={() => setOpen(!open)} icon={<MoreHorizontal className="size-4" />} aria-expanded={open}>
        {label}
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setOpen(false)
                it.onClick()
              }}
            >
              <span className="text-slate-400">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Liste déroulante avec recherche (pour de longues listes d'entreprises). */
export function SearchSelect<T extends { id: number; name: string }>({
  options,
  value,
  onChange,
  placeholder = 'Rechercher…',
  invalid,
  disabled
}: {
  options: T[]
  value: number | null
  onChange: (id: number | null, opt: T | null) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const id = useId()
  const selected = options.find((o) => o.id === value) ?? null
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const filtered = options.filter((o) => norm(o.name).includes(norm(q))).slice(0, 50)
  return (
    <div className="relative">
      <Input
        id={id}
        disabled={disabled}
        invalid={invalid}
        value={open ? q : (selected?.name ?? '')}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true)
          setQ('')
          setHi(0)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value)
          setHi(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, filtered.length - 1))
          if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0))
          if (e.key === 'Enter' && filtered[hi]) {
            e.preventDefault()
            onChange(filtered[hi].id, filtered[hi])
            setOpen(false)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">Aucun résultat</div>}
          {filtered.map((o, i) => (
            <div
              key={o.id}
              onMouseDown={() => {
                onChange(o.id, o)
                setOpen(false)
              }}
              className={cx('cursor-pointer px-3 py-1.5 text-sm', i === hi ? 'bg-brand-50 text-brand-900' : 'hover:bg-slate-50', o.id === value && 'font-semibold')}
            >
              {o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <span>
        {from}–{to} sur <b>{total.toLocaleString('fr-FR')}</b>
      </span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <Select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="w-auto py-1">
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} par page
              </option>
            ))}
          </Select>
        )}
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Précédent
        </Button>
        <span>
          Page {page} / {pages}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Suivant
        </Button>
      </div>
    </div>
  )
}
