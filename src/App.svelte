<script>
  import { onMount } from 'svelte'
  import AdminPage from './routes/AdminPage.svelte'
  import GalleryPage from './routes/GalleryPage.svelte'
  import PhotoPage from './routes/PhotoPage.svelte'

  function resolveHash() {
    const path = window.location.hash.slice(1) || '/'
    if (path === '/admin') return { page: 'admin', id: '' }

    const photo = path.match(/^\/photo\/([^/]+)$/)
    if (photo) {
      try {
        return { page: 'photo', id: decodeURIComponent(photo[1]) }
      } catch {
        return { page: 'not-found', id: '' }
      }
    }

    return path === '/' ? { page: 'gallery', id: '' } : { page: 'not-found', id: '' }
  }

  let route = $state(resolveHash())

  onMount(() => {
    const updateRoute = () => { route = resolveHash() }
    window.addEventListener('hashchange', updateRoute)
    return () => window.removeEventListener('hashchange', updateRoute)
  })
</script>

{#if route.page === 'admin'}
  <AdminPage />
{:else if route.page === 'photo'}
  <PhotoPage id={route.id} />
{:else if route.page === 'gallery'}
  <GalleryPage />
{:else}
  <main class="empty-page"><p>没有找到这个页面。</p><a href="#/">返回影集</a></main>
{/if}
