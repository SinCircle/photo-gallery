<script>
  import { onMount } from 'svelte'
  import liquidGL from 'liquid-gl'
  import PressButton from './PressButton.svelte'
  import { REDUCED_MOTION_QUERY } from '../lib/motion.js'

  let { photoCount, onRandom } = $props()
  let reducedMotion = $state(false)
  let glassUnavailable = $state(false)
  let glassEffect = null

  onMount(() => {
    const preference = window.matchMedia(REDUCED_MOTION_QUERY)
    const updatePreference = () => {
      reducedMotion = preference.matches
      attachGlass()
    }
    updatePreference()
    preference.addEventListener('change', updatePreference)
    return () => {
      preference.removeEventListener('change', updatePreference)
      glassEffect?.destroy?.()
    }
  })

  function attachGlass() {
    glassEffect?.destroy?.()
    glassEffect = null
    glassUnavailable = false
    if (reducedMotion) return

    try {
      glassEffect = liquidGL({
        engine: 'auto',
        snapshot: 'body',
        target: '#gallery-glass-dock',
        resolution: 1.25,
        refraction: 0.035,
        bevelDepth: 0.1,
        bevelWidth: 0.18,
        frost: 1,
        shadow: false,
        specular: false,
        reveal: 'none',
        interaction: 'fluid',
        interactionStrength: 0.36,
        interactionRadius: 0.42,
        interactionViscosity: 0.72,
        tint: 'rgba(8, 11, 13, 0.32)',
      })
      if (!glassEffect) glassUnavailable = true
    } catch (error) {
      console.warn('[liquidGL] 使用 CSS 磨砂玻璃降级', error)
      glassUnavailable = true
    }
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
  }
</script>

<nav id="gallery-glass-dock" class="glass-dock" class:fallback={glassUnavailable} aria-label="影集快捷操作">
  <div class="dock-content">
    <span class="dock-count"><strong>{photoCount}</strong><span>张照片</span></span>
    <span class="dock-divider" aria-hidden="true"></span>
    <PressButton className="dock-button" onclick={onRandom} disabled={photoCount === 0}>随机看一张</PressButton>
    <PressButton className="dock-button secondary" onclick={scrollToTop}>回到顶部</PressButton>
  </div>
</nav>

<style>
  .glass-dock {
    position: fixed;
    z-index: 80;
    left: 50%;
    bottom: max(18px, env(safe-area-inset-bottom));
    width: max-content;
    max-width: calc(100vw - 24px);
    padding: 7px;
    border: 1px solid #ffffff35;
    border-radius: 999px;
    background: rgba(14, 17, 19, .64);
    box-shadow: 0 16px 48px #0008, inset 0 1px #ffffff20;
    color: #f1f3f0;
    -webkit-backdrop-filter: blur(22px) saturate(155%);
    backdrop-filter: blur(22px) saturate(155%);
  }

  .glass-dock.fallback {
    background: rgba(18, 22, 24, .76);
  }

  .dock-content {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .dock-count {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 0 12px;
    color: #b7c2bd;
    font-size: 11px;
    white-space: nowrap;
  }

  .dock-count strong {
    color: #fff;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
  }

  .dock-divider {
    width: 1px;
    height: 23px;
    margin-right: 3px;
    background: #ffffff28;
  }

  @media (max-width: 500px) {
    .glass-dock {
      bottom: max(12px, env(safe-area-inset-bottom));
    }

    .dock-count {
      padding: 0 7px;
    }

  }
</style>
