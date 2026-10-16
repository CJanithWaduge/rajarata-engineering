const forms = Array.from(document.querySelectorAll<HTMLFormElement>('[data-editor-form]'));

for (const form of forms) {
  const selections = Array.from(form.querySelectorAll<HTMLSelectElement>('[data-media-select]'));

  for (const selection of selections) {
    const wrapper = selection.closest('.grid');
    const image = wrapper?.querySelector<HTMLImageElement>('[data-media-preview]');
    const fallback = wrapper?.querySelector<HTMLElement>('[data-media-fallback]');
    const status = wrapper?.querySelector<HTMLElement>('[data-media-preview-status]');
    if (!image || !fallback || !status) continue;

    const showUnavailable = (message: string) => {
      image.classList.add('hidden');
      image.removeAttribute('src');
      fallback.classList.remove('hidden');
      status.textContent = message;
    };

    const updatePreview = () => {
      const option = selection.selectedOptions[0];
      const imageUrl = option?.dataset.mediaUrl;
      if (!imageUrl) {
        showUnavailable(option?.value ? 'This asset is unavailable. Choose a different image.' : 'No image assigned.');
        return;
      }

      image.classList.remove('hidden');
      fallback.classList.add('hidden');
      status.textContent = 'Loading protected image preview…';
      image.onload = () => {
        status.textContent = `${option.textContent?.trim() ?? 'Image'} · ${image.naturalWidth} × ${image.naturalHeight}`;
      };
      image.onerror = () => showUnavailable('Preview unavailable. The draft reference has not been changed.');
      image.src = imageUrl;
    };

    selection.addEventListener('change', updatePreview);
    image.addEventListener('error', () => {
      showUnavailable('Preview unavailable. The draft reference has not been changed.');
    });
    if (selection.value) updatePreview();
  }
}
