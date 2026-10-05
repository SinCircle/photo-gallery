<script>
  import { onMount } from 'svelte'
  import PressButton from '../components/PressButton.svelte'

  let { id } = $props()
  let photos = $state([])
  let loading = $state(true)
  let error = $state('')

  let activeIndex = $derived(photos.findIndex((photo) => photo.id === id))
  let photo = $derived(photos[activeIndex] ?? null)
  let previousPhoto = $derived(activeIndex > 0 ? photos[activeIndex - 1] : null)
  let nextPhoto = $derived(activeIndex >= 0 && activeIndex < photos.length - 1 ? photos[activeIndex + 1] : null)

  onMount(() => {
    void loadPhotos()
  })

  async function loadPhotos() {
    try {
      const response = await fetch('/api/photos')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '照片读取失败')
      photos = result.photos
    } catch (cause) {
      error = cause.message || '无法读取照片，请稍后重试。'
    } finally {
      loading = false
    }
  }

  function imageUrl(entry) {
    const rendition = entry.derived?.web ? 'web' : 'originals'
    return `/media/${rendition}/${encodeURIComponent(entry.id)}`
  }

  function originalUrl(entry) {
    return `/media/originals/${encodeURIComponent(entry.id)}`
  }

  function recoverImage(event, entry) {
    const image = event.currentTarget
    const original = originalUrl(entry)
    if (image.dataset.retried !== 'true' && image.getAttribute('src') !== original) {
      image.dataset.retried = 'true'
      image.src = original
    } else {
      image.hidden = true
    }
  }

  function moveTo(entry) {
    if (entry) window.location.hash = `#/photo/${encodeURIComponent(entry.id)}`
  }

  function goBack() {
    window.location.hash = '#/'
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') goBack()
    if (event.key === 'ArrowLeft' && previousPhoto) moveTo(previousPhoto)
    if (event.key === 'ArrowRight' && nextPhoto) moveTo(nextPhoto)
  }

  function readableDate(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(date)
  }
</script>

<svelte:head>
  <title>{photo?.title || '单张照片'} · 个人影集</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main class="photo-page">
  <header class="photo-topbar">
    <PressButton className="back-button" onclick={goBack}><span aria-hidden="true">←</span> 返回影集</PressButton>
    <span class="photo-index">{#if photo}{String(activeIndex + 1).padStart(2, '0')} <i>/</i> {String(photos.length).padStart(2, '0')}{/if}</span>
  </header>

  {#if loading}
    <div class="photo-state" role="status">正在打开照片…</div>
  {:else if error}
    <div class="photo-state state-error" role="alert">{error}<button type="button" onclick={loadPhotos}>重新加载</button></div>
  {:else if !photo}
    <div class="photo-state">没有找到这张照片。<button type="button" onclick={goBack}>返回影集</button></div>
  {:else}
    <section class="photo-layout" aria-label="照片详情">
      <div class="photo-visual">
        <div class="large-image-frame" style={`aspect-ratio:${Math.max(1, photo.width || 4)}/${Math.max(1, photo.height || 3)}`}>
          <img
            src={imageUrl(photo)}
            alt={photo.title || photo.id}
            width={photo.width || undefined}
            height={photo.height || undefined}
            decoding="async"
            fetchpriority="high"
            onerror={(event) => recoverImage(event, photo)}
          />
        </div>
        <a class="original-link" href={originalUrl(photo)} target="_blank" rel="noreferrer">在新标签页打开原图 ↗</a>
      </div>

      <aside class="photo-information">
        <p class="eyebrow">留住这一刻</p>
        <h1>{photo.title || '未命名照片'}</h1>
        {#if photo.takenAt}
          <p class="taken-date">{readableDate(photo.takenAt)}</p>
        {/if}
        <p class="description">{photo.description || '这张照片还没有描述。'}</p>

        {#if photo.exif?.length}
          <section class="exif-section" aria-labelledby="exif-title">
            <h2 id="exif-title">拍摄信息</h2>
            <dl>
              {#each photo.exif as field, index (`${field.label}-${index}`)}
                <div class="exif-row"><dt>{field.label}</dt><dd>{field.value}</dd></div>
              {/each}
            </dl>
          </section>
        {/if}

        <p class="file-name">{photo.id}</p>
      </aside>
    </section>

    <nav class="photo-navigation" aria-label="照片导航">
      {#if previousPhoto}
        <PressButton className="navigation-button" onclick={() => moveTo(previousPhoto)} ariaLabel="上一张照片">
          <span aria-hidden="true">←</span><span><small>上一张</small><strong>{previousPhoto.title || previousPhoto.id}</strong></span>
        </PressButton>
      {:else}
        <span class="navigation-placeholder">已经是第一张</span>
      {/if}
      <PressButton className="return-button" onclick={goBack}>返回照片墙</PressButton>
      {#if nextPhoto}
        <PressButton className="navigation-button next-button" onclick={() => moveTo(nextPhoto)} ariaLabel="下一张照片">
          <span><small>下一张</small><strong>{nextPhoto.title || nextPhoto.id}</strong></span><span aria-hidden="true">→</span>
        </PressButton>
      {:else}
        <span class="navigation-placeholder">已经是最后一张</span>
      {/if}
    </nav>
  {/if}
</main>

<style>
  .photo-page {
    min-height: 100vh;
    padding: 24px clamp(18px, 4.5vw, 74px) 38px;
    background:
      radial-gradient(ellipse at 45% 38%, #1c201e35, transparent 48rem),
      #090a0b;
  }

  .photo-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 42px;
    color: #a7aaa5;
  }

  .photo-index {
    color: #b9beb8;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    letter-spacing: .14em;
  }

  .photo-index i {
    padding: 0 4px;
    color: #575c57;
    font-style: normal;
  }

  .photo-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(250px, 310px);
    align-items: center;
    gap: clamp(30px, 5vw, 90px);
    width: min(100%, 1500px);
    min-height: min(78vh, 920px);
    margin: 0 auto;
    padding: 25px 0 42px;
  }

  .photo-visual {
    display: grid;
    justify-items: center;
    gap: 13px;
    min-width: 0;
  }

  .large-image-frame {
    display: grid;
    width: min(100%, 1180px);
    max-height: 76vh;
    place-items: center;
    overflow: hidden;
    background: #0d0f0f;
  }

  .large-image-frame img {
    display: block;
    width: 100%;
    height: 100%;
    max-height: 76vh;
    object-fit: contain;
  }

  .original-link {
    justify-self: end;
    color: #929992;
    font-size: 11px;
    text-decoration: none;
    transition: color 150ms ease;
  }

  .original-link:hover {
    color: #d3ddd4;
  }

  .photo-information {
    align-self: center;
    padding: 12px 0;
  }

  .eyebrow {
    margin: 0 0 15px;
    color: #94aa9a;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .2em;
  }

  h1 {
    margin: 0;
    color: #f0f0eb;
    font-size: clamp(27px, 3.2vw, 40px);
    font-weight: 450;
    letter-spacing: -.045em;
    line-height: 1.25;
  }

  .taken-date {
    margin: 12px 0 0;
    color: #868d87;
    font-size: 12px;
  }

  .description {
    margin: 23px 0 0;
    color: #c0c1bc;
    font-size: 14px;
    line-height: 1.9;
    white-space: pre-wrap;
  }

  .exif-section {
    margin-top: 37px;
    padding-top: 20px;
    border-top: 1px solid #ffffff16;
  }

  .exif-section h2 {
    margin: 0 0 16px;
    color: #aeb5ae;
    font-size: 11px;
    font-weight: 550;
    letter-spacing: .13em;
  }

  .exif-section dl {
    display: grid;
    gap: 12px;
    margin: 0;
  }

  .exif-row {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    color: #d6d7d2;
    font-size: 12px;
  }

  .exif-row dt {
    color: #7f8580;
  }

  .exif-row dd {
    margin: 0;
    text-align: right;
  }

  .file-name {
    margin: 28px 0 0;
    overflow-wrap: anywhere;
    color: #656b66;
    font-size: 10px;
  }

  .photo-navigation {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    width: min(100%, 1500px);
    margin: 0 auto;
    padding-top: 19px;
    border-top: 1px solid #ffffff13;
  }

  .navigation-placeholder {
    color: #636862;
    font-size: 11px;
  }

  .photo-state {
    display: grid;
    min-height: 70vh;
    place-content: center;
    gap: 15px;
    color: #a6aaa4;
    text-align: center;
  }

  .photo-state button {
    justify-self: center;
    border: 0;
    background: transparent;
    color: #c8d4ca;
    cursor: pointer;
  }

  .state-error {
    color: #e4a89d;
  }

  @media (max-width: 850px) {
    .photo-layout {
      grid-template-columns: minmax(0, 1fr);
      gap: 27px;
      min-height: unset;
      padding: 32px 0 37px;
    }

    .large-image-frame,
    .large-image-frame img {
      max-height: 66vh;
    }

    .photo-information {
      width: min(100%, 660px);
      justify-self: center;
    }

    .photo-navigation {
      grid-template-columns: 1fr 1fr;
    }

  }

  @media (max-width: 500px) {
    .photo-page {
      padding: 16px 16px 28px;
    }

    .photo-layout {
      padding-top: 23px;
    }

    .large-image-frame,
    .large-image-frame img {
      max-height: 56vh;
    }

  }

  @media (prefers-reduced-motion: reduce) {
    .original-link {
      transition: none;
    }
  }
</style>
