import { useEffect, useRef, useState, type RefObject } from 'react'
import { chat, type ChatMessage } from '../data/chat'
import { readableTail } from '../domain/chatRead'
import { messageOf } from './base'

export function useChatRead(groupId: string, userId: string | undefined, messages: ChatMessage[], scroller: RefObject<HTMLDivElement | null>, retry: number) {
  const acknowledged = useRef(new Set<string>())
  const sending = useRef(false)
  const reschedule = useRef<() => void>(() => {})
  const [issue, setIssue] = useState('')
  useEffect(() => {
    const node = scroller.current
    if (!node || !userId || !messages.some(message => message.senderId !== userId && !message.deletedAt)) { setIssue(''); return }
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const membership = messages.at(-1)!.membershipSince
    const key = (message: ChatMessage) => groupId + ':' + userId + ':' + membership + ':' + message.id + ':' + message.version
    function visible() {
      if (document.visibilityState !== 'visible' || !document.hasFocus() || document.querySelector('dialog[open]')) return []
      const bounds = node!.getBoundingClientRect()
      const clip = { top: Math.max(bounds.top + node!.clientTop, 0), bottom: Math.min(bounds.top + node!.clientTop + node!.clientHeight, innerHeight), left: Math.max(bounds.left + node!.clientLeft, 0), right: Math.min(bounds.left + node!.clientLeft + node!.clientWidth, innerWidth) }
      return messages.filter(message => {
        if (message.senderId === userId || message.deletedAt || message.membershipSince !== membership || acknowledged.current.has(key(message))) return false
        const bubble = node!.querySelector<HTMLElement>('[data-message-id="' + message.id + '"] .chat-bubble')
        if (!bubble) return false
        const tail = readableTail(bubble.getBoundingClientRect(), clip)
        if (!tail) return false
        // Fixed navigation, headers and overlays must not cover the visible end.
        const x = (tail.left + tail.right) / 2, inset = Math.min(8, (tail.bottom - tail.top) / 2)
        return [tail.top + inset, (tail.top + tail.bottom) / 2, tail.bottom - inset].every(y => {
          const hit = document.elementFromPoint(x, y)
          return !!hit && bubble.contains(hit)
        })
      })
    }
    function schedule() {
      clearTimeout(timer)
      const candidates = visible()
      if (!candidates.length) return
      const stable = new Set(candidates.map(key))
      timer = setTimeout(() => {
        if (!active || sending.current) return
        const batch = visible().filter(message => stable.has(key(message))).slice(0, 30)
        if (!batch.length) return
        sending.current = true
        let success = false
        void chat.read(groupId, membership, batch.map(({ id, version }) => ({ id, version }))).then(() => {
          success = true
          batch.forEach(message => acknowledged.current.add(key(message)))
          if (active) setIssue('')
        }).catch(error => { if (active) setIssue(messageOf(error)) }).finally(() => {
          sending.current = false
          if (success || !active) reschedule.current()
        })
      }, 500)
    }
    const observer = new IntersectionObserver(schedule, { threshold: [0, 0.5, 1] })
    node.querySelectorAll('.chat-bubble').forEach(item => observer.observe(item))
    const resize = new ResizeObserver(schedule)
    resize.observe(node)
    const hasDialog = (node: Node) => node instanceof Element && (node.matches('dialog') || !!node.querySelector('dialog'))
    const dialogs = new MutationObserver(records => {
      if (records.some(record => record.type === 'attributes' ? record.target instanceof HTMLDialogElement
        : [...record.addedNodes, ...record.removedNodes].some(hasDialog))) schedule()
    })
    dialogs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    window.addEventListener('focus', schedule)
    window.addEventListener('blur', schedule)
    window.addEventListener('resize', schedule)
    window.addEventListener('online', schedule)
    reschedule.current = schedule
    schedule()
    return () => {
      active = false; clearTimeout(timer); observer.disconnect(); resize.disconnect(); dialogs.disconnect()
      if (reschedule.current === schedule) reschedule.current = () => {}
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      window.removeEventListener('focus', schedule); window.removeEventListener('blur', schedule)
      window.removeEventListener('resize', schedule); window.removeEventListener('online', schedule)
    }
  }, [groupId, userId, messages, scroller, retry])
  return issue
}
