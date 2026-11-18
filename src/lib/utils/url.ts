/**
 * FMO 地址工具。
 *
 * 对齐 FmoLogs 的 `src/utils/urlUtils.js`：地址里若显式写了 ws/wss(http/https)
 * 前缀，就以地址自带的协议为准；否则回退到用户在设置里选的 protocol。
 * 这样 `fmo.local` / `fmo1.local` / `192.168.1.10:8080` / `https://fmo.local`
 * 等写法都能构造出正确的 WS / HTTP URL，且不会拼出 `/ws/ws` 这种重复路径。
 */

export type WsProtocol = 'ws' | 'wss'
export type HttpProtocol = 'http' | 'https'

/** 标准化主机名：去协议前缀与尾部斜杠，保留端口与路径。 */
export function normalizeHost(address: string): string {
  if (!address) return ''
  return address
    .trim()
    .replace(/^(https?|wss?):?\/\//i, '')
    .replace(/\/+$/, '')
}

/** 从地址（或协议字符串）推断 WebSocket 协议；无显式协议时用 fallback。 */
export function resolveWebSocketProtocol(
  addressOrProtocol: string,
  fallback: WsProtocol = 'ws'
): WsProtocol {
  const value = String(addressOrProtocol || '')
    .trim()
    .toLowerCase()
  if (value === 'wss' || value === 'https' || value.startsWith('wss://') || value.startsWith('https://')) {
    return 'wss'
  }
  if (value === 'ws' || value === 'http' || value.startsWith('ws://') || value.startsWith('http://')) {
    return 'ws'
  }
  return fallback === 'wss' ? 'wss' : 'ws'
}

/** 构造 WebSocket URL；path 已存在于 host 末尾时不重复拼接。 */
export function buildWebSocketUrl(
  address: string,
  path = '/ws',
  fallbackProtocol: WsProtocol = 'ws'
): string {
  const host = normalizeHost(address)
  const protocol = resolveWebSocketProtocol(address, fallbackProtocol)
  const normalizedPath = path ? `/${String(path).replace(/^\/+/, '')}` : ''
  if (!normalizedPath || !host || host.endsWith(normalizedPath)) {
    return `${protocol}://${host}`
  }
  return `${protocol}://${host}${normalizedPath}`
}

/** 由 WebSocket 协议推断对应 HTTP 协议：wss→https，否则 http。 */
export function resolveHttpProtocol(
  addressOrProtocol: string,
  fallback: HttpProtocol = 'http'
): HttpProtocol {
  return resolveWebSocketProtocol(addressOrProtocol, fallback === 'https' ? 'wss' : 'ws') === 'wss'
    ? 'https'
    : 'http'
}

/** 构造 HTTP URL；path 已存在于 host 末尾时不重复拼接。 */
export function buildHttpUrl(
  address: string,
  path = '',
  fallbackProtocol: HttpProtocol = 'http'
): string {
  const host = normalizeHost(address)
  const protocol = resolveHttpProtocol(address, fallbackProtocol)
  const normalizedPath = path ? `/${String(path).replace(/^\/+/, '')}` : ''
  if (!normalizedPath || !host || host.endsWith(normalizedPath)) {
    return `${protocol}://${host}`
  }
  return `${protocol}://${host}${normalizedPath}`
}

/** 把一条地址拆成标准化的 {host, protocol}，供存储前归一化。 */
export function normalizeWebSocketEndpoint(
  address: string,
  fallbackProtocol: WsProtocol = 'ws'
): { host: string; protocol: WsProtocol } {
  return {
    host: normalizeHost(address),
    protocol: resolveWebSocketProtocol(address, fallbackProtocol)
  }
}
