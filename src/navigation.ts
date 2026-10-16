/**
 * Navigation choice: whether this device keeps the three navigation lines in AGENTS.md
 * (`written`) or has them delivered through the SessionStart/SubagentStart pointer hooks
 * (`declined`). Read from `<deviceHome>/machine-settings.json` (schema tcrn.machine-settings.v1,
 * key `agents.navigation`, engine machine-settings.ts). The lines themselves come from the engine;
 * this plugin never hard-codes them. Reading never throws.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const MACHINE_SETTINGS_FILE = 'machine-settings.json'
export const AGENTS_NAVIGATION_SETTING = 'agents.navigation'
export type NavigationChoice = 'written' | 'declined' | null

/** The device's navigation choice, or null when unset, unreadable, or not one of the two choices. */
export async function readNavigationChoice(deviceHome: string): Promise<NavigationChoice> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(deviceHome, MACHINE_SETTINGS_FILE), 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return null
    const values = (parsed as { values?: unknown }).values
    if (values === null || typeof values !== 'object') return null
    const value = (values as Record<string, unknown>)[AGENTS_NAVIGATION_SETTING]
    return value === 'written' || value === 'declined' ? value : null
  } catch {
    return null
  }
}
