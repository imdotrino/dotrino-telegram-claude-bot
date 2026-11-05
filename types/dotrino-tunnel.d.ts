// @dotrino/tunnel 0.3 no publica tipos: aquí va lo que este repo usa de él.
declare module '@dotrino/tunnel' {
  /** Una petición que llega por el túnel. */
  export interface TunnelRequest {
    method: string
    path: string
    headers: Record<string, string | undefined>
    body: Buffer | null
  }
  /** Lo que el manejador contesta. */
  export interface TunnelResponse {
    status?: number
    headers?: Record<string, string>
    body?: string | Buffer | object | null
  }
  /** Abre el túnel de un aparato enrolado; `url` se sabe antes de conectar (sale de la llave). */
  export function createTunnel (opts: {
    target?: number | string | ((req: TunnelRequest) => Promise<TunnelResponse> | TunnelResponse)
    server?: string
    name?: string
    dir?: string
    quiet?: boolean
    lock?: boolean
    onReady?: (url: string) => void | Promise<void>
    onRejected?: (reason: string, message: string) => void
  }): Promise<{ url: string, key: string, close: () => void }>
}
