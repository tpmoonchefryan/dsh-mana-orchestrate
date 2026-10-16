import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_ROUTE, statusBody } from '../src/index.ts'

describe('status route body', () => {
  it('reports no recall before the first run', () => {
    assert.equal(STATUS_ROUTE, '/mana-orchestrate/status')
    assert.deepEqual(statusBody(undefined, null), {
      plugin: 'dsh-mana-orchestrate', lastReasonCode: null, at: null, event: null, detail: null, bridgeDuplicate: false, navigation: null,
    })
  })
  it('carries the last reason code and flags a bridge duplicate', () => {
    const body = statusBody({ reasonCode: 'MANA_RECALL_BRIDGE_DUPLICATE', at: '2026-10-16T00:00:00.000Z', event: 'user-prompt-submit' }, 'declined')
    assert.equal(body.lastReasonCode, 'MANA_RECALL_BRIDGE_DUPLICATE')
    assert.equal(body.bridgeDuplicate, true)
    assert.equal(body.navigation, 'declined')
  })
})
