<script>
  import { onMount } from 'svelte'

  const MAX_UPLOAD_BYTES = Math.floor(14.7 * 1024 * 1024)

  let authenticated = $state(false)
  let checkingSession = $state(true)
  let password = $state('')
  let photos = $state([])
  let drafts = $state({})
  let selectedFile = $state(null)
  let loadingPhotos = $state(false)
  let loggingIn = $state(false)
  let uploading = $state(false)
  let savingId = $state('')
  let deletingId = $state('')
  let feedback = $state('')
  let feedbackKind = $state('status')

  onMount(() => {
    void restoreSession()
  })

  async function readResponse(response) {
    let body = {}
    try {
      body = await response.json()
    } catch {
      body = {}
    }
    if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`)
    return body
  }

  function setFeedback(message, kind = 'status') {
    feedback = message
    feedbackKind = kind
  }

  function setPhotoList(nextPhotos) {
    photos = nextPhotos
    drafts = Object.fromEntries(nextPhotos.map((photo) => [photo.id, {
      title: photo.title ?? '',
      description: photo.description ?? '',
    }]))
  }

  async function restoreSession() {
    try {
      const session = await readResponse(await fetch('/api/session'))
      authenticated = session.authenticated
      if (authenticated) await refreshPhotos()
    } catch (error) {
      setFeedback(error.message || '无法读取登录状态，请刷新重试。', 'error')
    } finally {
      checkingSession = false
    }
  }

  async function refreshPhotos() {
    loadingPhotos = true
    try {
      const result = await readResponse(await fetch('/api/photos'))
      setPhotoList(result.photos)
    } finally {
      loadingPhotos = false
    }
  }

  async function submitLogin(event) {
    event.preventDefault()
    loggingIn = true
    setFeedback('')
    try {
      await readResponse(await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      }))
      authenticated = true
      password = ''
      await refreshPhotos()
      setFeedback('已登录，可以管理照片。')
    } catch (error) {
      setFeedback(error.message || '登录失败，请重试。', 'error')
    } finally {
      loggingIn = false
    }
  }

  async function submitLogout() {
    try {
      await readResponse(await fetch('/api/logout', { method: 'POST' }))
      authenticated = false
      setPhotoList([])
      setFeedback('已退出管理。')
    } catch (error) {
      setFeedback(error.message || '退出失败，请重试。', 'error')
    }
  }

  function chooseFile(event) {
    selectedFile = event.currentTarget.files?.[0] ?? null
    setFeedback('')
    if (selectedFile && selectedFile.size > MAX_UPLOAD_BYTES) {
      selectedFile = null
      setFeedback('所选原图超过 14.7 MB，请选择较小的文件。', 'error')
    }
  }

  async function submitUpload(event) {
    event.preventDefault()
    const fileInput = event.currentTarget.querySelector('input[type="file"]')
    if (!selectedFile) {
      setFeedback('请先选择一张照片。', 'error')
      return
    }

    uploading = true
    setFeedback('正在上传原图并生成网页尺寸照片，请稍候。')
    try {
      const form = new FormData()
      form.append('file', selectedFile)
      const photo = await readResponse(await fetch('/api/upload', { method: 'POST', body: form }))
      await refreshPhotos()
      if (photo.derived?.thumb && photo.derived?.web) {
        setFeedback('照片已上传，缩略图和网页图均已生成。')
      } else {
        const details = photo.warnings?.filter(Boolean).join('；')
        setFeedback(`原图已保存，但衍生图未全部生成。${details ? ` ${details}` : '画廊会对缺失档位回退显示原图。'}`, 'warning')
      }
      selectedFile = null
      if (fileInput) fileInput.value = ''
    } catch (error) {
      setFeedback(error.message || '上传失败，请稍后重试。', 'error')
    } finally {
      uploading = false
    }
  }

  function hasChanges(photo) {
    const draft = drafts[photo.id]
    return draft && (draft.title !== (photo.title ?? '') || draft.description !== (photo.description ?? ''))
  }

  async function savePhoto(photo) {
    if (!hasChanges(photo)) return
    savingId = photo.id
    setFeedback('')
    try {
      const encodedId = encodeURIComponent(photo.id)
      const updated = await readResponse(await fetch(`/api/photo/${encodedId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(drafts[photo.id]),
      }))
      photos = photos.map((entry) => entry.id === updated.id ? updated : entry)
      drafts = {
        ...drafts,
        [updated.id]: { title: updated.title ?? '', description: updated.description ?? '' },
      }
      setFeedback('标题与描述已保存。')
    } catch (error) {
      setFeedback(error.message || '保存失败，请重试。', 'error')
    } finally {
      savingId = ''
    }
  }

  async function removePhoto(photo) {
    if (!window.confirm(`确定删除「${photo.title || photo.id}」吗？原图和衍生图都会被删除。`)) return
    deletingId = photo.id
    setFeedback('')
    try {
      await readResponse(await fetch('/api/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: photo.id }),
      }))
      setPhotoList(photos.filter((entry) => entry.id !== photo.id))
      setFeedback('照片及其衍生文件已删除。')
    } catch (error) {
      setFeedback(error.message || '删除失败，请重试。', 'error')
    } finally {
      deletingId = ''
    }
  }

  function previewUrl(photo) {
    const rendition = photo.derived?.thumb ? 'thumbs' : 'originals'
    return `/media/${rendition}/${encodeURIComponent(photo.id)}`
  }
</script>

<svelte:head>
  <title>照片管理 · 个人影集</title>
</svelte:head>

{#if checkingSession}
  <main class="admin-loading" aria-live="polite">正在读取管理登录状态…</main>
{:else if !authenticated}
  <main class="login-shell">
    <section class="login-card">
      <a class="back-link" href="#/">← 返回影集</a>
      <p class="eyebrow">PRIVATE STUDIO</p>
      <h1>照片管理</h1>
      <p class="login-intro">输入管理密码后，可以上传照片并编辑已有内容。</p>
      <form class="login-form" onsubmit={submitLogin}>
        <label for="admin-password">管理密码</label>
        <input
          id="admin-password"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
          disabled={loggingIn}
        />
        <button class="primary-button" type="submit" disabled={loggingIn}>
          {loggingIn ? '正在登录…' : '进入管理'}
        </button>
      </form>
      {#if feedback}
        <p class="feedback" class:error={feedbackKind === 'error'} role="status">{feedback}</p>
      {/if}
    </section>
  </main>
{:else}
  <main class="admin-shell">
    <header class="admin-header">
      <div>
        <p class="eyebrow">PHOTO LIBRARY</p>
        <h1>照片管理</h1>
        <p class="admin-count">{photos.length} 张照片</p>
      </div>
      <div class="header-actions">
        <a class="quiet-link" href="#/">返回影集</a>
        <button class="quiet-button" type="button" onclick={submitLogout}>退出登录</button>
      </div>
    </header>

    <section class="upload-panel" aria-labelledby="upload-title">
      <div class="upload-copy">
        <p class="eyebrow">ADD TO LIBRARY</p>
        <h2 id="upload-title">上传照片</h2>
        <p>支持 JPEG、PNG、WebP、AVIF 与 GIF，单张原图最大 14.7 MB。</p>
      </div>
      <form class="upload-form" onsubmit={submitUpload}>
        <label class="file-picker">
          <span>{selectedFile ? selectedFile.name : '选择一张照片'}</span>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.avif,.gif,image/jpeg,image/png,image/webp,image/avif,image/gif"
            onchange={chooseFile}
            disabled={uploading}
          />
        </label>
        {#if selectedFile}
          <small>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</small>
        {/if}
        <button class="primary-button" type="submit" disabled={uploading || !selectedFile}>
          {uploading ? '正在上传…' : '上传照片'}
        </button>
      </form>
    </section>

    {#if feedback}
      <p class="feedback admin-feedback" class:error={feedbackKind === 'error'} class:warning={feedbackKind === 'warning'} role="status" aria-live="polite">{feedback}</p>
    {/if}

    <section class="photo-section" aria-labelledby="photo-list-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">YOUR PHOTOGRAPHS</p>
          <h2 id="photo-list-title">全部照片</h2>
        </div>
        {#if loadingPhotos}<span class="loading-label">正在读取…</span>{/if}
      </div>

      {#if photos.length === 0 && !loadingPhotos}
        <p class="empty-state">照片库目前为空，上传第一张照片后会显示在这里。</p>
      {:else}
        <div class="admin-grid">
          {#each photos as photo (photo.id)}
            <article class="photo-card">
              <a class="photo-preview" href={`#/photo/${encodeURIComponent(photo.id)}`} aria-label={`打开 ${photo.title || photo.id}`}>
                <img src={previewUrl(photo)} alt={photo.title || photo.id} loading="lazy" />
              </a>
              <div class="photo-fields">
                <label>
                  <span>标题</span>
                  <input bind:value={drafts[photo.id].title} placeholder="给这张照片起个名字" />
                </label>
                <label>
                  <span>描述</span>
                  <textarea bind:value={drafts[photo.id].description} rows="3" placeholder="写下拍摄时的故事或地点"></textarea>
                </label>
                <div class="photo-actions">
                  <button class="primary-button small-button" type="button" onclick={() => savePhoto(photo)} disabled={!hasChanges(photo) || savingId === photo.id}>
                    {savingId === photo.id ? '保存中…' : '保存信息'}
                  </button>
                  <button class="danger-button" type="button" onclick={() => removePhoto(photo)} disabled={deletingId === photo.id}>
                    {deletingId === photo.id ? '删除中…' : '删除'}
                  </button>
                </div>
                {#if !photo.derived?.thumb || !photo.derived?.web}
                  <p class="derived-warning">这张照片有衍生图尚未生成。</p>
                {/if}
                <p class="photo-id">{photo.id}</p>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>
  </main>
{/if}

<style>
  .admin-loading,
  .login-shell,
  .admin-shell {
    min-height: 100vh;
  }

  .admin-loading {
    display: grid;
    place-items: center;
    color: #a9a8a5;
  }

  .login-shell {
    display: grid;
    place-items: center;
    padding: 32px 20px;
    background: radial-gradient(ellipse at 50% 0%, #252729 0, #0b0c0e 55%);
  }

  .login-card {
    width: min(100%, 430px);
    padding: 42px;
    border: 1px solid #ffffff18;
    border-radius: 24px;
    background: #111315d9;
    box-shadow: 0 28px 90px #0008;
  }

  .back-link,
  .quiet-link {
    color: #c5c4c0;
    text-decoration: none;
  }

  .back-link:hover,
  .quiet-link:hover {
    color: #fff;
  }

  .eyebrow {
    margin: 0 0 10px;
    color: #8eaaa0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .2em;
  }

  h1,
  h2,
  p {
    overflow-wrap: anywhere;
  }

  h1 {
    margin: 0;
    font-size: clamp(28px, 5vw, 42px);
    letter-spacing: -.04em;
  }

  .login-intro,
  .admin-count,
  .upload-copy > p:last-child {
    color: #aaa9a5;
    line-height: 1.7;
  }

  .login-form,
  .photo-fields label {
    display: grid;
    gap: 9px;
  }

  .login-form {
    margin-top: 28px;
  }

  .login-form label,
  .photo-fields label span {
    color: #d0cfcb;
    font-size: 13px;
  }

  input,
  textarea {
    width: 100%;
    border: 1px solid #ffffff1c;
    border-radius: 11px;
    outline: none;
    background: #090a0bdd;
    color: #f7f6f2;
    font: inherit;
  }

  input {
    min-height: 46px;
    padding: 0 13px;
  }

  textarea {
    min-height: 84px;
    padding: 12px 13px;
    resize: vertical;
  }

  input:focus,
  textarea:focus {
    border-color: #89a99c;
    box-shadow: 0 0 0 3px #89a99c24;
  }

  .primary-button,
  .quiet-button,
  .danger-button {
    min-height: 42px;
    padding: 0 16px;
    border: 1px solid transparent;
    border-radius: 999px;
    color: #f6f5f1;
    font: inherit;
    cursor: pointer;
    transition: transform 160ms ease, background 160ms ease, opacity 160ms ease;
  }

  .primary-button {
    background: #d8e1da;
    color: #131714;
    font-weight: 650;
  }

  .primary-button:hover:not(:disabled) {
    background: #f0f4ef;
    transform: translateY(-1px);
  }

  .quiet-button {
    border-color: #ffffff25;
    background: #ffffff0a;
  }

  .danger-button {
    border-color: #d4847455;
    background: #6d302733;
    color: #f0b8ab;
  }

  button:disabled {
    opacity: .48;
    cursor: not-allowed;
  }

  .feedback {
    margin: 18px 0 0;
    color: #b8d4c4;
    font-size: 14px;
    line-height: 1.6;
  }

  .feedback.error {
    color: #f1a99e;
  }

  .feedback.warning,
  .derived-warning {
    color: #e5bd78;
  }

  .admin-shell {
    width: min(100% - 40px, 1440px);
    margin: 0 auto;
    padding: 54px 0 90px;
  }

  .admin-header,
  .header-actions,
  .section-heading,
  .photo-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
  }

  .admin-count {
    margin: 8px 0 0;
  }

  .header-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .upload-panel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 32px;
    margin-top: 38px;
    padding: 26px 30px;
    border: 1px solid #ffffff16;
    border-radius: 20px;
    background: linear-gradient(115deg, #181b1ce8, #101213cc);
  }

  .upload-copy h2,
  .section-heading h2 {
    margin: 0;
    font-size: 21px;
  }

  .upload-copy > p:last-child {
    margin: 8px 0 0;
    font-size: 13px;
  }

  .upload-form {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    flex-wrap: wrap;
  }

  .upload-form small {
    color: #aaa9a5;
  }

  .file-picker {
    position: relative;
    display: grid;
    min-width: min(260px, 70vw);
    min-height: 42px;
    align-items: center;
    padding: 0 15px;
    overflow: hidden;
    border: 1px dashed #ffffff35;
    border-radius: 999px;
    color: #d7d6d1;
    cursor: pointer;
  }

  .file-picker span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-picker input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .admin-feedback {
    padding: 0 4px;
  }

  .photo-section {
    margin-top: 54px;
  }

  .section-heading {
    align-items: flex-end;
    margin-bottom: 20px;
  }

  .loading-label {
    color: #93928f;
    font-size: 13px;
  }

  .empty-state {
    padding: 42px 24px;
    border: 1px dashed #ffffff24;
    border-radius: 18px;
    color: #aaa9a5;
    text-align: center;
  }

  .admin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 18px;
  }

  .photo-card {
    min-width: 0;
    overflow: hidden;
    border: 1px solid #ffffff14;
    border-radius: 17px;
    background: #111315;
  }

  .photo-preview {
    display: grid;
    min-height: 190px;
    max-height: 340px;
    place-items: center;
    overflow: hidden;
    background: #08090a;
  }

  .photo-preview img {
    display: block;
    width: 100%;
    height: 100%;
    max-height: 340px;
    object-fit: cover;
  }

  .photo-fields {
    display: grid;
    gap: 15px;
    padding: 18px;
  }

  .photo-actions {
    justify-content: flex-start;
  }

  .small-button,
  .danger-button {
    min-height: 36px;
    padding: 0 14px;
    font-size: 13px;
  }

  .derived-warning {
    margin: 0;
    font-size: 12px;
  }

  .photo-id {
    margin: 0;
    overflow: hidden;
    color: #777875;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 700px) {
    .login-card {
      padding: 30px 24px;
    }

    .admin-shell {
      width: min(100% - 28px, 1440px);
      padding-top: 32px;
    }

    .upload-panel {
      align-items: flex-start;
      flex-direction: column;
      padding: 22px;
    }

    .upload-form {
      width: 100%;
      justify-content: stretch;
    }

    .file-picker {
      flex: 1 1 100%;
    }

    .header-actions {
      gap: 10px;
    }
  }
</style>
