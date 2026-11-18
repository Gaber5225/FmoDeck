import { describe, expect, it } from 'vitest'
import {
  buildHttpUrl,
  buildWebSocketUrl,
  normalizeHost,
  normalizeWebSocketEndpoint,
  resolveHttpProtocol,
  resolveWebSocketProtocol
} from './url'

describe('normalizeHost', () => {
  it('空值返回空字符串', () => {
    expect(normalizeHost('')).toBe('')
    expect(normalizeHost('   ')).toBe('')
  })

  it('去除 http/https 协议前缀', () => {
    expect(normalizeHost('http://fmo.local')).toBe('fmo.local')
    expect(normalizeHost('https://fmo.local')).toBe('fmo.local')
  })

  it('去除 ws/wss 协议前缀', () => {
    expect(normalizeHost('ws://fmo.local/ws')).toBe('fmo.local/ws')
    expect(normalizeHost('wss://fmo.local/ws')).toBe('fmo.local/ws')
  })

  it('去除尾部斜杠（含多连斜杠）', () => {
    expect(normalizeHost('fmo.local/')).toBe('fmo.local')
    expect(normalizeHost('fmo.local///')).toBe('fmo.local')
  })

  it('同时处理协议前缀和尾斜杠', () => {
    expect(normalizeHost('https://fmo.local/')).toBe('fmo.local')
  })

  it('保留端口和路径', () => {
    expect(normalizeHost('https://fmo.local:8080/api')).toBe('fmo.local:8080/api')
  })

  it('trim 外围空白', () => {
    expect(normalizeHost('  https://fmo.local  ')).toBe('fmo.local')
  })
})

describe('resolveWebSocketProtocol', () => {
  it('地址显式带 wss/https 时用 wss', () => {
    expect(resolveWebSocketProtocol('wss://fmo.local')).toBe('wss')
    expect(resolveWebSocketProtocol('https://fmo.local')).toBe('wss')
    expect(resolveWebSocketProtocol('WSS://fmo.local')).toBe('wss')
  })

  it('地址显式带 ws/http 时用 ws', () => {
    expect(resolveWebSocketProtocol('ws://fmo.local')).toBe('ws')
    expect(resolveWebSocketProtocol('http://fmo.local')).toBe('ws')
  })

  it('裸主机名（含 .local 别名与端口）回退到传入协议', () => {
    expect(resolveWebSocketProtocol('fmo.local')).toBe('ws')
    expect(resolveWebSocketProtocol('fmo1.local:8080')).toBe('ws')
    expect(resolveWebSocketProtocol('fmo.local', 'wss')).toBe('wss')
    expect(resolveWebSocketProtocol('192.168.1.10:8080', 'wss')).toBe('wss')
  })
})

describe('buildWebSocketUrl', () => {
  it('裸 fmo.local 别名拼出 ws://fmo.local/ws', () => {
    expect(buildWebSocketUrl('fmo.local')).toBe('ws://fmo.local/ws')
    expect(buildWebSocketUrl('fmo1.local', '/events')).toBe('ws://fmo1.local/events')
  })

  it('保留端口与 IP', () => {
    expect(buildWebSocketUrl('192.168.1.10:8080', '/ws')).toBe('ws://192.168.1.10:8080/ws')
  })

  it('地址自带协议时覆盖 fallback', () => {
    expect(buildWebSocketUrl('https://fmo.local', '/ws', 'ws')).toBe('wss://fmo.local/ws')
    expect(buildWebSocketUrl('wss://fmo.local', '/audio', 'ws')).toBe('wss://fmo.local/audio')
  })

  it('地址末尾已含目标路径时不重复拼接（避免 /ws/ws）', () => {
    expect(buildWebSocketUrl('fmo.local/ws', '/ws')).toBe('ws://fmo.local/ws')
    expect(buildWebSocketUrl('wss://fmo.local/events', '/events')).toBe('wss://fmo.local/events')
  })

  it('tail 空白与尾斜杠不影响结果', () => {
    expect(buildWebSocketUrl('  fmo.local/  ', '/ws')).toBe('ws://fmo.local/ws')
  })
})

describe('HTTP URL 工具', () => {
  it('resolveHttpProtocol 由 ws 协议推导', () => {
    expect(resolveHttpProtocol('https://fmo.local')).toBe('https')
    expect(resolveHttpProtocol('fmo.local')).toBe('http')
    expect(resolveHttpProtocol('fmo.local', 'https')).toBe('https')
  })

  it('buildHttpUrl 拼远程控制页且防重复', () => {
    expect(buildHttpUrl('fmo.local', '/remote.html')).toBe('http://fmo.local/remote.html')
    expect(buildHttpUrl('fmo.local/remote.html', '/remote.html')).toBe('http://fmo.local/remote.html')
    expect(buildHttpUrl('https://fmo.local', '/remote.html')).toBe('https://fmo.local/remote.html')
  })
})

describe('normalizeWebSocketEndpoint', () => {
  it('拆出标准化 host 与推断协议', () => {
    expect(normalizeWebSocketEndpoint('  https://fmo1.local/  ')).toEqual({
      host: 'fmo1.local',
      protocol: 'wss'
    })
    expect(normalizeWebSocketEndpoint('fmo.local', 'wss')).toEqual({
      host: 'fmo.local',
      protocol: 'wss'
    })
  })
})
