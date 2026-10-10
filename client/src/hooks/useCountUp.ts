import { useEffect, useRef, useState } from "react"

const DURATION_MS = 1200

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export default function useCountUp(end: number) {
  const ref = useRef<HTMLElement | null>(null)
  const [count, setCount] = useState(0)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (typeof IntersectionObserver === "undefined") {
      setCount(end)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || hasAnimated.current) return
        hasAnimated.current = true

        const startTime = performance.now()
        const startValue = 0

        const tick = (now: number) => {
          const progress = Math.min((now - startTime) / DURATION_MS, 1)
          const eased = easeOutCubic(progress)
          const value = Math.round(startValue + (end - startValue) * eased)
          setCount(value)

          if (progress < 1) {
            requestAnimationFrame(tick)
          }
        }

        requestAnimationFrame(tick)
        observer.disconnect()
      },
      { threshold: 0.3 }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [end])

  return { count, ref }
}
