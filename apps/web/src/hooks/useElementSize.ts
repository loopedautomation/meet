"use client"

import { type RefObject, useEffect, useState } from "react"

/** {0, 0} until the first client-side measurement — callers should treat
 * that as "not measured yet" rather than an actual zero-size element. */
export function useElementSize<T extends HTMLElement>(
  ref: RefObject<T | null>,
) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}
