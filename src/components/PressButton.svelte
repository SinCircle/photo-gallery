<script>
  import { onMount } from 'svelte'
  import { Spring } from 'svelte/motion'
  import { REDUCED_MOTION_QUERY, SPRING_OPTIONS } from '../lib/motion.js'

  let {
    children,
    className = '',
    type = 'button',
    disabled = false,
    onclick,
    ariaLabel,
  } = $props()

  const scaleX = new Spring(1, SPRING_OPTIONS)
  const scaleY = new Spring(1, SPRING_OPTIONS)
  const lift = new Spring(0, SPRING_OPTIONS)
  const tiltX = new Spring(0, SPRING_OPTIONS)
  const tiltY = new Spring(0, SPRING_OPTIONS)
  let reducedMotion = $state(false)
  let activePointer = null
  let startX = 0
  let startY = 0
  let pulseTimer

  onMount(() => {
    const preference = window.matchMedia(REDUCED_MOTION_QUERY)
    const updatePreference = () => {
      reducedMotion = preference.matches
      if (reducedMotion) resetMotion(true)
    }
    updatePreference()
    preference.addEventListener('change', updatePreference)
    return () => {
      preference.removeEventListener('change', updatePreference)
      clearTimeout(pulseTimer)
    }
  })

  function setSpring(spring, value, instant = reducedMotion) {
    spring.set(value, instant ? { instant: true } : undefined)
  }

  function resetMotion(instant = reducedMotion) {
    setSpring(scaleX, 1, instant)
    setSpring(scaleY, 1, instant)
    setSpring(lift, 0, instant)
    setSpring(tiltX, 0, instant)
    setSpring(tiltY, 0, instant)
  }

  function pointerEnter(event) {
    if (reducedMotion || event.pointerType !== 'mouse') return
    setSpring(lift, 3)
  }

  function pointerDown(event) {
    if (disabled || reducedMotion) return
    activePointer = event.pointerId
    startX = event.clientX
    startY = event.clientY
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setSpring(scaleX, 0.96)
    setSpring(scaleY, 0.96)
    setSpring(lift, 1)
  }

  function pointerMove(event) {
    if (reducedMotion) return
    const bounds = event.currentTarget.getBoundingClientRect()

    if (activePointer === event.pointerId) {
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (Math.abs(dx) >= Math.abs(dy)) {
        setSpring(scaleX, 0.96 + Math.min(0.055, Math.abs(dx) / 800))
        setSpring(scaleY, 0.96 - Math.min(0.03, Math.abs(dx) / 1200))
      } else {
        setSpring(scaleY, 0.96 + Math.min(0.055, Math.abs(dy) / 800))
        setSpring(scaleX, 0.96 - Math.min(0.03, Math.abs(dy) / 1200))
      }
      return
    }

    if (event.pointerType !== 'mouse') return
    const horizontal = (event.clientX - bounds.left) / Math.max(1, bounds.width) - 0.5
    const vertical = (event.clientY - bounds.top) / Math.max(1, bounds.height) - 0.5
    setSpring(tiltX, -vertical * 3)
    setSpring(tiltY, horizontal * 3)
  }

  function pointerUp(event) {
    if (activePointer !== event.pointerId) return
    const distance = Math.hypot(event.clientX - startX, event.clientY - startY)
    activePointer = null
    setSpring(tiltX, 0)
    setSpring(tiltY, 0)
    clearTimeout(pulseTimer)
    if (distance < 8 && !reducedMotion) {
      setSpring(scaleX, 1.035)
      setSpring(scaleY, 1.035)
      pulseTimer = setTimeout(() => resetMotion(), 85)
    } else {
      resetMotion()
    }
  }

  function pointerLeave() {
    if (activePointer !== null) return
    setSpring(tiltX, 0)
    setSpring(tiltY, 0)
    setSpring(lift, 0)
  }
</script>

<button
  class={`spring-control ${className}`}
  type={type}
  disabled={disabled}
  aria-label={ariaLabel}
  style={`--spring-scale-x:${scaleX.current};--spring-scale-y:${scaleY.current};--spring-lift:${-lift.current}px;--spring-tilt-x:${tiltX.current}deg;--spring-tilt-y:${tiltY.current}deg`}
  onpointerenter={pointerEnter}
  onpointerdown={pointerDown}
  onpointermove={pointerMove}
  onpointerup={pointerUp}
  onpointercancel={pointerUp}
  onpointerleave={pointerLeave}
  {onclick}
>
  {@render children?.()}
</button>

<style>
  :global(.spring-control) {
    transform: translateY(var(--spring-lift, 0)) rotateX(var(--spring-tilt-x, 0deg)) rotateY(var(--spring-tilt-y, 0deg)) scale(var(--spring-scale-x, 1), var(--spring-scale-y, 1));
    transform-origin: center;
    transform-style: preserve-3d;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    will-change: transform;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.spring-control) {
      transition-duration: 0s !important;
      will-change: auto;
    }
  }
</style>
