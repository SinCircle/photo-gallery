<script>
  let { id } = $props()
</script>

<svelte:head>
  <title>照片 · 个人影集</title>
</svelte:head>

<main class="empty-page" aria-label="单张照片" data-photo-id={id}></main>
