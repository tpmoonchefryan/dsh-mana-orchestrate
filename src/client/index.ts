/**
 * Browser half: one fail-soft, read-only status card; the host status route is its only data source.
 * It is the plugin's `settings.plugin.item` entry (key `mana-orchestrate`) where the settings surface
 * mounts that slot (DSH-TWP-STORY-013 AC7), and a `shell.overlay` card on hosts without it.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { StatusCard } from './status-card.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugin.item': {
      kind: 'keyed'
      scope: 'root'
      keyProps: { 'mana-orchestrate': Record<string, never> }
    }
  }
}

export const inject = ['slots'] as const

export function apply(ctx: ClientContext): void {
  // The settings surface owns this slot; register into it only when it is mounted.
  if (ctx.slots.spec('settings.plugin.item') !== undefined) {
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      key: 'mana-orchestrate',
      priority: 10,
      registrant: 'dsh-mana-orchestrate',
      inject: () => ({}),
    }, StatusCard))
    return
  }
  ctx.slots.register({
    name: 'shell.overlay',
    id: 'mana-orchestrate-status-card',
    order: -100,
    registrant: 'dsh-mana-orchestrate',
  }, StatusCard)
}
