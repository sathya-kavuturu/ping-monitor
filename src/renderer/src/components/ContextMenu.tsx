import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface ContextMenuProps {
  /** Viewport coordinates (e.g. from the triggering `contextmenu` event's `clientX`/`clientY`). */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * Small right-click menu, positioned at the click point and clamped to stay
 * inside the viewport. Closes on outside click, another right-click
 * elsewhere, or Escape - the outside-click listener is attached a tick after
 * mount so the very `contextmenu` event that opened this menu doesn't also
 * immediately close it.
 */
function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const maxLeft = window.innerWidth - rect.width - 8
    const maxTop = window.innerHeight - rect.height - 8
    setPos({ left: Math.min(x, Math.max(8, maxLeft)), top: Math.min(y, Math.max(8, maxTop)) })
  }, [x, y])

  useEffect(() => {
    const handleOutside = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleOutside)
      window.addEventListener('contextmenu', handleOutside)
    }, 0)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('contextmenu', handleOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <div className="context-menu" style={{ left: pos.left, top: pos.top }} ref={menuRef}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`context-menu-item ${item.danger ? 'context-menu-item--danger' : ''}`}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default ContextMenu
