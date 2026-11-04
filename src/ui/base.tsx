import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, X, LoaderCircle, CircleAlert, CheckCircle2, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'

export function IconBox({ icon: Icon, tone = 'purple' }: { icon: LucideIcon; tone?: string }) {
  return <span className={'iconbox tone-' + tone}><Icon size={19} strokeWidth={1.9} aria-hidden /></span>
}
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={'card ' + className}>{children}</section>
}
export function CardTitle({ icon, title, sub, tone, action }: { icon?: LucideIcon; title: string; sub?: string; tone?: string; action?: ReactNode }) {
  return <div className="card-title">{icon && <IconBox icon={icon} tone={tone} />}<div className="min-w-0"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{action && <div className="ml-auto shrink-0">{action}</div>}</div>
}
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="text-link" to={to}>{children}<ArrowUpRight size={14} aria-hidden /></Link>
}
export function PageTitle({ label, title, description, action }: { label: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-title"><div><p className="eyebrow">{label}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</header>
}
export function Progress({ value, label, tone = 'purple' }: { value: number; label: string; tone?: string }) {
  return <div className={'progress progress-' + tone} role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: value + '%' }} /></div>
}
export function Empty({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="empty"><IconBox icon={Icon} /><strong>{title}</strong><p>{description}</p>{action}</div>
}
export function Loading() {
  return <div className="empty" role="status"><LoaderCircle className="animate-spin" size={25} />불러오는 중…</div>
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="error-state" role="alert"><CircleAlert size={18} /> <span>{message}</span>{retry && <button className="btn btn-soft" onClick={retry}>다시 시도</button>}</div>
}
export function Toast({ message, error, close }: { message: string; error?: boolean; close: () => void }) {
  const Icon = error ? CircleAlert : CheckCircle2
  const node = <div className={'toast ' + (error ? 'toast-error' : '')} role={error ? 'alert' : 'status'}><Icon size={18} /><span>{message}</span><button aria-label="알림 닫기" className="icon-button" onClick={close}><X size={16} /></button></div>
  const dialog = document.querySelector('dialog[open]')
  return error && dialog ? createPortal(node, dialog) : node
}
export function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = ref.current
    node?.showModal()
    return () => node?.close()
  }, [])
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); close() }} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <div className="dialog-inner"><div className="flex items-center justify-between gap-4"><h2>{title}</h2><button className="icon-button" aria-label="창 닫기" onClick={close}><X size={20} /></button></div>{children}</div>
  </dialog>
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}
export const messageOf = (e: unknown) => e instanceof Error ? e.message : '다시 시도해 주세요.'
