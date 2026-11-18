import type { FmoRequest, FmoResponse } from '@/types/fmo-protocol'

export interface ReconnectOptions {
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

export interface FmoClientOptions {
  requestTimeoutMs?: number
  /** 建连超时；mDNS（fmo.local / fmo1.local）解析卡住时兜底，对齐 FmoLogs 的 5s 探测。 */
  connectTimeoutMs?: number
  reconnect?: ReconnectOptions
}

const DEFAULT_RECONNECT: ReconnectOptions = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000

/**
 * 服务器不规范返回的 response subType 别名映射。
 * 例：`station/getListRange` 请求的响应 subType 是 `getListResponse`（不是 `getListRangeResponse`）。
 */
const RESPONSE_ALIASES: Record<string, Record<string, string>> = {
  station: { getListRange: 'getListResponse' }
}

interface QueuedRequest {
  req: FmoRequest
  resolve: (value: FmoResponse) => void
  reject: (reason: unknown) => void
}

interface InFlightRequest extends QueuedRequest {
  timer: ReturnType<typeof setTimeout>
}

/**
 * FMO WebSocket 客户端（路线 B · 串行队列）。
 *
 * fmo.local 服务端不回传 reqId（见 plan §附录 · Task 1 探测结果），
 * 故采用 FmoLogs 同款策略：同时只 in-flight 1 个请求，按
 * `${subType}Response === ${requestSubType}Response` 匹配响应。
 *
 * 具备：指数退避自动重连、连接关闭时清空队列、请求超时保护、推送监听。
 */
export class FmoApiClient {
  private ws: WebSocket | null = null
  private readonly queue: QueuedRequest[] = []
  private inFlight: InFlightRequest | null = null
  private readonly requestTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly reconnectOpts: ReconnectOptions
  private reconnectAttempts = 0
  private shouldReconnect = false
  private connectPromise: Promise<void> | null = null
  private readonly listeners = new Set<(msg: FmoResponse) => void>()

  constructor(
    private readonly url: string,
    opts: FmoClientOptions = {}
  ) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 10_000
    this.connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.reconnectOpts = opts.reconnect ?? DEFAULT_RECONNECT
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise
    this.shouldReconnect = true
    // 失败后必须清空 connectPromise，否则后续 connect() 会一直拿到
    // 那个 rejected Promise，再也不会重试（mDNS 偶发失败时尤其致命）。
    const pending = this.doConnect().catch((err) => {
      this.connectPromise = null
      throw err
    })
    this.connectPromise = pending
    return pending
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 一旦 open / error / timeout 中任一发生就锁定结果，避免重复 settle。
      let settled = false
      const ws = new WebSocket(this.url)
      this.ws = ws

      // 关键：mDNS 名字（fmo.local / fmo1.local）解析失败时，WebSocket 会
      // 长时间停在 CONNECTING，既不 onopen 也不 onerror。没有超时就会假死，
      // 表现就是"很多时候连不上"。5s 后主动 close 触发 onclose → 进入重连。
      const connectTimer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          ws.close()
        } catch {
          /* 忽略：close 失败也会由下面的路径收尾 */
        }
        reject(new Error('WebSocket connection timeout'))
      }, this.connectTimeoutMs)

      ws.onopen = () => {
        clearTimeout(connectTimer)
        if (settled) return
        settled = true
        this.reconnectAttempts = 0
        resolve()
      }
      ws.onmessage = (ev) => this.handleMessage(ev)
      ws.onclose = () => {
        clearTimeout(connectTimer)
        if (!settled) {
          settled = true
          reject(new Error('WebSocket closed before open'))
        }
        this.ws = null
        this.failAllPending(new Error('WebSocket closed'))
        if (this.shouldReconnect) this.scheduleReconnect()
      }
      ws.onerror = () => {
        clearTimeout(connectTimer)
        if (!settled) {
          settled = true
          reject(new Error('WebSocket error'))
        }
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.reconnectOpts.maxAttempts) return
    const delay = Math.min(
      this.reconnectOpts.initialDelayMs * 2 ** this.reconnectAttempts,
      this.reconnectOpts.maxDelayMs
    )
    this.reconnectAttempts++
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connectPromise = this.doConnect().catch(() => {
          this.connectPromise = null
        })
      }
    }, delay)
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.failAllPending(new Error('Client disconnected'))
    this.ws?.close()
    this.ws = null
    this.connectPromise = null
  }

  /**
   * 发送请求，入队等待。同时只有 1 个 in-flight；响应按 subType 匹配。
   */
  send(req: FmoRequest): Promise<FmoResponse> {
    if (!this.isConnected) return Promise.reject(new Error('Not connected'))
    return new Promise((resolve, reject) => {
      this.queue.push({ req, resolve, reject })
      this.processQueue()
    })
  }

  private processQueue(): void {
    if (this.inFlight || this.queue.length === 0) return
    const next = this.queue.shift()!
    const timer = setTimeout(() => {
      if (this.inFlight === flight) {
        this.inFlight = null
        next.reject(new Error(`Request timeout: ${next.req.type}/${next.req.subType}`))
        this.processQueue()
      }
    }, this.requestTimeoutMs)
    const flight: InFlightRequest = { ...next, timer }
    this.inFlight = flight
    this.ws!.send(JSON.stringify(next.req))
  }

  private handleMessage(ev: MessageEvent): void {
    let msg: FmoResponse
    try {
      msg = JSON.parse(ev.data as string) as FmoResponse
    } catch {
      return
    }

    // 先尝试匹配 in-flight 请求：
    //   响应的 subType 必须是请求的 `${subType}Response`（FmoLogs 同款约定）
    //   特殊映射 RESPONSE_ALIASES 处理服务器不规范返回（如 station/getListRange → getListResponse）
    if (this.inFlight) {
      const reqSubType = this.inFlight.req.subType
      const responseSubType =
        RESPONSE_ALIASES[this.inFlight.req.type]?.[reqSubType] ?? `${reqSubType}Response`
      if (
        msg.type === this.inFlight.req.type &&
        (msg.subType === responseSubType || msg.subType === reqSubType)
      ) {
        clearTimeout(this.inFlight.timer)
        const resolve = this.inFlight.resolve
        this.inFlight = null
        resolve(msg)
        this.processQueue()
        return
      }
    }

    // 非响应：视为服务端推送
    this.listeners.forEach((cb) => cb(msg))
  }

  onPush(listener: (msg: FmoResponse) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private failAllPending(error: Error): void {
    if (this.inFlight) {
      clearTimeout(this.inFlight.timer)
      this.inFlight.reject(error)
      this.inFlight = null
    }
    for (const q of this.queue) q.reject(error)
    this.queue.length = 0
  }
}
