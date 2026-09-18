/**
 * `@local/dsh-locale-ru` — host half.
 *
 * The pack is browser-only: the locale registry, its setting, and persistence
 * all live in the client and in `@deepseek-ai/dsh-client-locale`'s node half.
 * This entry exists so the profile tree has a mountable row whose package
 * metadata (`dsh.client`) puts the Russian dictionaries into the browser
 * roster.
 *
 * @module @local/dsh-locale-ru
 */

/** Cordis plugin name. */
export const name = 'locale-ru'

/** Host-side plugin body: nothing to do on the Host. */
export function apply() {}

export default { name, apply }
