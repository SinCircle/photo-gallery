<script>
  import { onMount } from 'svelte'
  import FloatingDock from '../components/FloatingDock.svelte'

  let photos = $state([])
  let loading = $state(true)
  let error = $state('')

  onMount(() => {
    void loadPhotos()
  })

  async function loadPhotos() {
    loading = true
    error = ''
    try {
      const response = await fetch('/api/photos')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '照片读取失败')
      photos = result.photos
    } catch (cause) {
      error = cause.message || '无法连接照片服务，请稍后重试。'
    } finally {
      loading = false
    }
  }

  function imageUrl(photo) {
    const rendition = photo.derived?.thumb ? 'thumbs' : 'originals'
    return `/media/${rendition}/${encodeURIComponent(photo.id)}`
  }

  function originalUrl(photo) {
    return `/media/originals/${encodeURIComponent(photo.id)}`
  }

  function recoverImage(event, photo) {
    const image = event.currentTarget
    const original = originalUrl(photo)
    if (image.dataset.retried !== 'true' && image.getAttribute('src') !== original) {
      image.dataset.retried = 'true'
      image.src = original
    } else {
      image.hidden = true
      image.parentElement?.classList.add('image-unavailable')
    }
  }

  function caption(photo) {
    if (photo.title?.trim()) return photo.title
    if (!photo.takenAt) return '未命名照片'
    return new Date(photo.takenAt).toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  }

  function openRandomPhoto() {
    if (photos.length === 0) return
    const photo = photos[Math.floor(Math.random() * photos.length)]
    window.location.hash = `#/photo/${encodeURIComponent(photo.id)}`
  }
</script>

<svelte:head>
  <title>个人影集</title>
  <meta name="description" content="一座安静的个人影像档案。" />
</svelte:head>

<main class="gallery-page">
  <header class="gallery-hero">
    <div class="signature"><span class="signature-mark" aria-hidden="true">◌</span><span>个人影像档案</span></div>
    <div class="hero-copy">
      <p class="hero-kicker">把经过的光，留在这里</p>
      <h1>日常有光，<br /><em>影像有回声。</em></h1>
      <p class="hero-description">一座慢慢收集的个人影像档案。没有特别的主题，只记录曾经看见的风景。</p>
    </div>
    <div class="collection-meta"><span class="meta-dot" aria-hidden="true"></span><span>{#if loading}正在整理照片{:else}{photos.length} 张照片{/if}</span><span class="meta-separator">·</span><span>一条平铺的影像长廊</span></div>
  </header>

  <section class="gallery-section" aria-label="全部照片">
    {#if error}
      <div class="gallery-message error-message" role="alert">
        <p>暂时无法打开影集</p>
        <span>{error}</span>
        <button type="button" onclick={loadPhotos}>重新加载</button>
      </div>
    {:else if loading}
      <div class="gallery-message" role="status">正在读取影像…</div>
    {:else if photos.length === 0}
      <div class="gallery-message">影集还是空的，之后拍下的照片会出现在这里。</div>
    {:else}
      <div class="masonry-gallery">
        {#each photos as photo, index (photo.id)}
          {@const width = Math.max(1, photo.width || 4)}
          {@const height = Math.max(1, photo.height || 3)}
          <a
            class="photo-tile"
            href={`#/photo/${encodeURIComponent(photo.id)}`}
            aria-label={`查看照片：${caption(photo)}`}
          >
            <div class="photo-frame" style={`aspect-ratio:${width}/${height}`}>
              <img
                src={imageUrl(photo)}
                alt={caption(photo)}
                width={width}
                height={height}
                loading={index < 6 ? 'eager' : 'lazy'}
                decoding="async"
                fetchpriority={index < 3 ? 'high' : 'auto'}
                onerror={(event) => recoverImage(event, photo)}
              />
              <span class="photo-caption">{caption(photo)}</span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <footer class="gallery-footer"><span>保存那些不想匆忙忘记的时刻。</span><span>影像档案 · {photos.length}</span></footer>
  <FloatingDock photoCount={photos.length} onRandom={openRandomPhoto} />
</main>

<style>
  .gallery-page {
    min-height: 100vh;
    padding: 0 clamp(18px, 4.5vw, 76px) 144px;
    background:
      radial-gradient(ellipse at 15% 5%, #25292852, transparent 32rem),
      radial-gradient(ellipse at 100% 28%, #20222134, transparent 34rem),
      #090a0b;
  }

  .gallery-hero {
    position: relative;
    max-width: 1660px;
    margin: 0 auto;
    padding: 35px 0 42px;
  }

  .signature {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #a3aaa5;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .22em;
  }

  .signature-mark {
    color: #cad6ce;
    font-size: 24px;
    line-height: .7;
  }

  .hero-copy {
    max-width: 620px;
    margin: clamp(56px, 9vh, 110px) 0 0 clamp(4px, 8vw, 130px);
  }

  .hero-kicker {
    margin: 0 0 18px;
    color: #9eb4a8;
    font-size: 12px;
    letter-spacing: .13em;
  }

  h1 {
    margin: 0;
    color: #eeefeb;
    font-size: clamp(40px, 7.5vw, 88px);
    font-weight: 450;
    letter-spacing: -.075em;
    line-height: 1.12;
  }

  h1 em {
    color: #b7c5bb;
    font-family: "Iowan Old Style", "Songti SC", "Noto Serif SC", serif;
    font-weight: 400;
    font-style: normal;
  }

  .hero-description {
    max-width: 390px;
    margin: 22px 0 0;
    color: #90918e;
    font-size: 13px;
    line-height: 1.9;
  }

  .collection-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 52px 0 0 clamp(4px, 8vw, 130px);
    color: #868984;
    font-size: 11px;
    letter-spacing: .04em;
  }

  .meta-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #9cae9f;
    box-shadow: 0 0 14px #9cae9f70;
  }

  .meta-separator {
    color: #4d514d;
  }

  .gallery-section {
    max-width: 1660px;
    margin: 0 auto;
  }

  .masonry-gallery {
    columns: 4 250px;
    column-gap: clamp(10px, 1.35vw, 20px);
  }

  .photo-tile {
    display: inline-block;
    width: 100%;
    margin: 0 0 clamp(10px, 1.35vw, 20px);
    overflow: hidden;
    break-inside: avoid;
    border-radius: 4px;
    background: #111413;
    text-decoration: none;
  }

  .photo-frame {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: #141716;
    isolation: isolate;
  }

  .photo-frame::after {
    position: absolute;
    z-index: 1;
    inset: 45% 0 0;
    background: linear-gradient(transparent, #070909aa);
    content: "";
    opacity: .45;
    transition: opacity 180ms ease;
    pointer-events: none;
  }

  .photo-frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #151817;
    transition: transform 300ms cubic-bezier(.2, .7, .2, 1), filter 250ms ease;
  }

  .photo-caption {
    position: absolute;
    z-index: 2;
    right: 16px;
    bottom: 14px;
    left: 16px;
    overflow: hidden;
    color: #f0f0ec;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: .025em;
    text-overflow: ellipsis;
    text-shadow: 0 1px 10px #000a;
    white-space: nowrap;
    opacity: .9;
    pointer-events: none;
  }

  .photo-tile:hover .photo-frame img {
    transform: scale(1.025);
    filter: brightness(1.04);
  }

  .photo-tile:hover .photo-frame::after {
    opacity: .78;
  }

  .photo-tile:active .photo-frame img {
    transform: scale(.985);
  }

  :global(.photo-frame.image-unavailable) {
    display: grid;
    place-items: center;
    min-height: 150px;
  }

  .gallery-message {
    display: grid;
    min-height: 220px;
    place-content: center;
    gap: 9px;
    color: #a3a6a1;
    font-size: 14px;
    text-align: center;
  }

  .error-message p {
    margin: 0;
    color: #f0ede6;
    font-size: 18px;
  }

  .error-message span {
    color: #b8958e;
  }

  .error-message button {
    justify-self: center;
    margin-top: 8px;
    border: 0;
    background: transparent;
    color: #c5d1c7;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .gallery-footer {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    max-width: 1660px;
    margin: 55px auto 0;
    padding-top: 18px;
    border-top: 1px solid #ffffff12;
    color: #747874;
    font-size: 10px;
    letter-spacing: .04em;
  }

  @media (max-width: 700px) {
    .gallery-hero {
      padding-top: 25px;
      padding-bottom: 30px;
    }

    .hero-copy {
      margin-top: 68px;
      margin-left: 3px;
    }

    .collection-meta {
      flex-wrap: wrap;
      margin-top: 36px;
      margin-left: 3px;
    }

    .masonry-gallery {
      columns: 2 145px;
    }

    .photo-caption {
      right: 10px;
      bottom: 9px;
      left: 10px;
      font-size: 10px;
    }

    .gallery-footer {
      flex-direction: column;
      gap: 8px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .photo-frame::after,
    .photo-frame img {
      transition: none;
    }

    .photo-tile:hover .photo-frame img,
    .photo-tile:active .photo-frame img {
      transform: none;
    }
  }
</style>
