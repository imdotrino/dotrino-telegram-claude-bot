// @dotrino/update no publica tipos: aquí va lo que este repo usa de él.
declare module '@dotrino/update' {
  /** Lo que devuelve una consulta: hay versión nueva, al día, o no se pudo mirar (que NO es «al día»). */
  export type UpdateCheck =
    | { ok: true, newer: boolean, version: string, current: string, source: 'npm' | 'github', pkg?: string, repo?: string }
    | { ok: false, reason: string }
  export const CHECK_EVERY_MS: number
  /** ¿`a` es más nuevo que `b`? (semver x.y.z) */
  export function isNewer (a: string, b: string): boolean
  /** ¿Hay algo más nuevo que `current` en npm (`pkg`) o en las releases de GitHub (`repo`)? */
  export function checkForUpdate (opts: {
    current: string
    source: 'npm' | 'github'
    pkg?: string
    repo?: string
    timeoutMs?: number
  }): Promise<UpdateCheck>
  /** Mira al arrancar y una vez al día; llama a `onNewer` si hay versión nueva. Devuelve cómo pararlo. */
  export function watchForUpdate (opts: {
    current: string
    source: 'npm' | 'github'
    pkg?: string
    repo?: string
    everyMs?: number
    onNewer?: (r: { version: string, current: string }) => void
  }): () => void
}

declare module '@dotrino/update/checkout' {
  /** Mira al arrancar y una vez al día si el checkout `dir` va detrás de `repo@branch`. Devuelve cómo pararlo. */
  export function watchCheckout (opts: {
    dir: string
    repo: string
    branch?: string
    name?: string
    log?: (msg: string) => void
    onBehind?: (r: { running: string, latest: string }) => void
    everyMs?: number
  }): () => void
}
