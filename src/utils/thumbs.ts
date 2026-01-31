export async function getThumbnailObjectUrl(pregenThumbUrl: string): Promise<string> {
  try {
    const res = await fetch(pregenThumbUrl, { cache: 'force-cache' });
    if (res.ok) {
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      return obj;
    } else {
      throw new Error('Failed to fetch pre-generated thumbnail.');
    }
  } catch (err) {
    console.error('Error loading pre-generated thumbnail:', err);
    throw new Error('Unable to load pre-generated thumbnail.');
  }
}
