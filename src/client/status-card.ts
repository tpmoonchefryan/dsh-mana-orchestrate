/**
 * Status card: the same shell.overlay component family as 0.1.0 (Button, DisclosureRow, Pill,
 * StateDot and status-card.module.css); only the data source changed to the host's
 * `/mana-orchestrate/status` route. Read-only and fail-soft.
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import {
  Button,
  DisclosureRow,
  Pill,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './status-card.module.css'

export const STATUS_ROUTE = '/mana-orchestrate/status'
const STATUS_CACHE_KEY = 'dsh-mana-orchestrate:status:last-known'
export const OVERLAY_STORAGE_KEY = 'dsh-mana-orchestrate:overlay-collapsed'
const DEFAULT_COLLAPSED = true
const TITLE = 'Mana Orchestrate 召回状态'

/** Mirrors the host's StatusBody (src/index.ts). */
interface StatusSurface {
  plugin: string
  lastReasonCode: string | null
  at: string | null
  event: string | null
  detail: Record<string, unknown> | null
  bridgeDuplicate: boolean
  navigation: 'written' | 'declined' | null
  source?: 'live' | 'cache'
}

interface StatusLine {
  id: string
  status: 'ok' | 'ko' | 'warning'
  text: string
}

const OK_CODES = new Set(['MANA_RECALL_ANSWERED', 'MANA_RECALL_EMPTY'])

const stateForStatus = (status: StatusLine['status']): StateDotState => {
  if (status === 'ko') return 'error'
  if (status === 'ok') return 'done'
  return 'warning'
}

export function statusLines(surface: StatusSurface | undefined): StatusLine[] {
  if (surface === undefined) return [{ id: 'loading', status: 'warning', text: '正在获取状态…' }]
  const code = surface.lastReasonCode
  const lines: StatusLine[] = [{
    id: 'recall',
    status: code === null ? 'warning' : OK_CODES.has(code) ? 'ok' : code === 'MANA_RECALL_BRIDGE_DUPLICATE' ? 'warning' : 'ko',
    text: code === null ? '最近一次召回：本进程尚未运行' : `最近一次召回：${code}${surface.event === null ? '' : `（${surface.event}）`}`,
  }]
  if (surface.bridgeDuplicate) lines.push({ id: 'bridge', status: 'warning', text: 'hooks-claude-code 桥已运行 Einzbern 钩子，本插件跳过该事件' })
  lines.push({
    id: 'navigation',
    status: surface.navigation === null ? 'warning' : 'ok',
    text: surface.navigation === 'declined' ? '导航行：经会话开始钩子注入' : surface.navigation === 'written' ? '导航行：写在 AGENTS.md' : '导航行：设备未设置',
  })
  return lines
}

const stateForSurface = (surface: StatusSurface | undefined): StateDotState => {
  if (surface === undefined) return 'ongoing'
  const lines = statusLines(surface)
  if (lines.some(line => line.status === 'ko')) return 'error'
  if (lines.some(line => line.status === 'warning')) return 'warning'
  return 'done'
}

const readCollapsedPreference = (): boolean => {
  try {
    const stored = localStorage.getItem(OVERLAY_STORAGE_KEY)
    return stored === null ? DEFAULT_COLLAPSED : stored !== 'false'
  } catch {
    return DEFAULT_COLLAPSED
  }
}

const sourceLabel = (surface: StatusSurface | undefined): string => surface?.source === 'cache' ? '状态 · 缓存' : '状态 · 实时'

export function StatusCard(): ReactElement {
  const [collapsed, setCollapsed] = useState(readCollapsedPreference)
  const [surface, setSurface] = useState<StatusSurface | undefined>()

  useEffect(() => {
    if (collapsed) return undefined
    const controller = new AbortController()
    void fetch(STATUS_ROUTE, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`status route HTTP ${response.status}`)
        return response.json() as Promise<StatusSurface>
      })
      .then(value => {
        setSurface({ ...value, source: 'live' })
        try { localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(value)) } catch { /* storage is an optional fallback */ }
      })
      .catch(() => {
        try {
          const cached = localStorage.getItem(STATUS_CACHE_KEY)
          if (cached !== null) setSurface({ ...(JSON.parse(cached) as StatusSurface), source: 'cache' })
        } catch { /* fail-soft: the badge remains useful without a snapshot */ }
      })
    return () => controller.abort()
  }, [collapsed])

  const toggle = (): void => {
    setCollapsed(current => {
      const next = !current
      try { localStorage.setItem(OVERLAY_STORAGE_KEY, String(next)) } catch { /* UI preference is optional */ }
      return next
    })
  }

  if (collapsed) {
    return createElement(
      'div',
      { className: css.badgeAnchor, 'data-mana-overlay-toggle': 'true', 'data-mana-overlay-collapsed': 'true' },
      createElement(
        Button,
        { variant: 'ghost', size: 'sm', 'aria-label': 'Mana Orchestrate 状态', 'aria-expanded': false, onClick: toggle },
        createElement('span', { 'aria-hidden': true }, 'M'),
      ),
    )
  }

  const lines = statusLines(surface)
  return createElement(
    'aside',
    {
      className: css.overlayCard,
      'aria-label': TITLE,
      'aria-live': 'polite',
      'data-mana-status-card': 'true',
      'data-mana-last-reason-code': surface?.lastReasonCode ?? 'none',
    },
    createElement(DisclosureRow, {
      className: css.overlayDisclosure,
      rowClassName: css.overlayHeader,
      titleClassName: css.overlayTitle,
      icon: createElement(StateDot, { state: stateForSurface(surface) }),
      title: TITLE,
      open: true,
      expandable: true,
      onToggle: toggle,
      collapsedContent: createElement(Pill, { active: surface?.source === 'live' }, sourceLabel(surface)),
      children: createElement(
        'div',
        { className: css.overlayBody },
        createElement(
          'div',
          { className: css.overlayActions },
          createElement(
            Button,
            { variant: 'ghost', size: 'sm', 'aria-label': '收起 Mana Orchestrate 状态', 'aria-expanded': true, onClick: toggle },
            '收起',
          ),
        ),
        createElement(
          'span',
          { className: css.source, 'data-mana-status-source': surface?.source ?? 'not-observed' },
          createElement(Pill, { active: surface?.source === 'live' }, sourceLabel(surface)),
        ),
        createElement(
          'ul',
          { className: css.doctorLines },
          ...lines.map(line => createElement(
            'li',
            { key: line.id, className: css.doctorLine, 'data-mana-status': line.status },
            createElement(StateDot, { state: stateForStatus(line.status) }),
            createElement('span', { className: css.doctorLineText }, createElement('span', null, line.text)),
          )),
        ),
        surface?.at == null ? null : createElement('p', null, `记录时间：${surface.at}`),
      ),
    }),
  )
}
