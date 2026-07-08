// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import AppContextMenu from './AppContextMenu'

function mountMessage(): HTMLElement {
  const msg = document.createElement('div')
  msg.className = 'msg off'
  msg.innerHTML = '<div class="lede">Headline here</div><div class="prose"><p id="para">Selectable message body text.</p></div>'
  document.body.appendChild(msg)
  return msg
}

function selectPara(): void {
  const para = document.getElementById('para')!
  const range = document.createRange()
  range.selectNodeContents(para)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

function rightClick(el: Element): void {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
    )
  })
}

function mouseDown(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })
}

describe('AppContextMenu copy in the message list', () => {
  const clipboardWrite = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    // Only the two clipboard methods are exercised; the rest of OfficerApi is irrelevant here.
    window.officer = {
      clipboardRead: vi.fn().mockResolvedValue(''),
      clipboardWrite
    } as unknown as typeof window.officer
  })
  afterEach(() => {
    clipboardWrite.mockClear()
    document.querySelectorAll('.msg').forEach((n) => n.remove())
    window.getSelection()?.removeAllRanges()
  })

  it('copies the selection via Copy', async () => {
    render(<AppContextMenu />)
    mountMessage()
    selectPara()
    rightClick(document.getElementById('para')!)
    const copy = [...document.querySelectorAll('.ctx-item')].find(
      (b) => b.textContent?.trim() === 'CopyCtrl+C' || b.textContent?.includes('Copy')
    ) as HTMLButtonElement
    expect(copy).toBeTruthy()
    expect(copy.disabled).toBe(false)
    mouseDown(copy)
    await vi.waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith('Selectable message body text.'))
  })

  it('copies the whole message via Copy message', async () => {
    render(<AppContextMenu />)
    mountMessage()
    rightClick(document.getElementById('para')!)
    const btn = [...document.querySelectorAll('.ctx-item')].find((b) =>
      b.textContent?.includes('Copy message')
    ) as HTMLButtonElement
    expect(btn).toBeTruthy()
    mouseDown(btn)
    await vi.waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith('Headline here\n\nSelectable message body text.')
    )
  })
})
