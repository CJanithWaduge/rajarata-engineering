import { MAX_MEDIA_BYTES, MEDIA_CONTENT_TYPES } from './contentModel';

const root = document.querySelector<HTMLElement>('[data-media-root]');

if (root) {
  const fileInput = root.querySelector<HTMLInputElement>('#media-file');
  const trigger = root.querySelector<HTMLButtonElement>('[data-file-trigger]');
  const dropzone = root.querySelector<HTMLElement>('[data-dropzone]');
  const selected = root.querySelector<HTMLElement>('[data-selected]');
  const preview = root.querySelector<HTMLImageElement>('[data-selected-img]');
  const placeholder = root.querySelector<HTMLElement>('[data-selected-placeholder]');
  const name = root.querySelector<HTMLElement>('[data-selected-name]');
  const metadata = root.querySelector<HTMLElement>('[data-selected-meta]');
  const alt = root.querySelector<HTMLTextAreaElement>('#media-alt');
  const altError = root.querySelector<HTMLElement>('#media-alt-error');
  const uploadButton = root.querySelector<HTMLButtonElement>('[data-upload-submit]');
  const uploadCancel = root.querySelector<HTMLButtonElement>('[data-upload-cancel]');
  const uploadMessage = root.querySelector<HTMLElement>('[data-upload-message]');
  const progressWrap = root.querySelector<HTMLElement>('[data-upload-progress-wrap]');
  const progress = root.querySelector<HTMLElement>('[data-upload-progress]');
  const progressBar = root.querySelector<HTMLElement>('[data-upload-progress-bar]');
  const progressLabel = root.querySelector<HTMLElement>('[data-upload-progress-label]');
  const viewLink = root.querySelector<HTMLAnchorElement>('[data-upload-view-link]');

  let selectedFile: File | undefined;
  let previewUrl: string | undefined;
  let activeRequest: XMLHttpRequest | undefined;

  const revokePreview = () => {
    if (!previewUrl) return;
    URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
  };

  const updateUploadEnabled = () => {
    if (uploadButton) uploadButton.disabled = !selectedFile || !alt?.value.trim() || Boolean(activeRequest);
  };

  const setAltError = (message: string) => {
    alt?.setAttribute('aria-invalid', String(Boolean(message)));
    if (altError) {
      altError.textContent = message;
      altError.classList.toggle('hidden', !message);
    }
  };

  const resetSelection = () => {
    if (activeRequest) activeRequest.abort();
    revokePreview();
    selectedFile = undefined;
    if (fileInput) fileInput.value = '';
    if (alt) {
      alt.value = '';
      alt.setAttribute('aria-invalid', 'false');
    }
    setAltError('');
    if (selected) selected.hidden = true;
    if (uploadMessage) uploadMessage.textContent = '';
    if (progressWrap) progressWrap.hidden = true;
    if (viewLink) viewLink.hidden = true;
    updateUploadEnabled();
  };

  const formatBytes = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
      : `${Math.max(1, Math.round(bytes / 1024))} KiB`;

  const showPreviewFailure = (message: string) => {
    if (preview) {
      preview.classList.add('hidden');
      preview.removeAttribute('src');
    }
    placeholder?.classList.remove('hidden');
    if (uploadMessage) uploadMessage.textContent = message;
    selectedFile = undefined;
    updateUploadEnabled();
  };

  const checkDecodedImage = (url: string) =>
    new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('The selected file cannot be decoded as an image.'));
      image.src = url;
    });

  const handleFile = async (file: File) => {
    revokePreview();
    selectedFile = undefined;
    if (selected) selected.hidden = false;
    if (name) name.textContent = file.name;
    if (metadata) metadata.textContent = `${file.type || 'unknown type'} · ${formatBytes(file.size)}`;
    setAltError('');
    if (!MEDIA_CONTENT_TYPES.includes(file.type as (typeof MEDIA_CONTENT_TYPES)[number])) {
      showPreviewFailure('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > MAX_MEDIA_BYTES) {
      showPreviewFailure(`The image must be no larger than ${formatBytes(MAX_MEDIA_BYTES)}.`);
      return;
    }

    previewUrl = URL.createObjectURL(file);
    if (preview) {
      preview.classList.remove('hidden');
      preview.src = previewUrl;
    }
    placeholder?.classList.add('hidden');
    if (uploadMessage) uploadMessage.textContent = '';
    if (alt) {
      alt.value = '';
      alt.focus();
    }
    setAltError('');
    updateUploadEnabled();

    try {
      const dimensions = await checkDecodedImage(previewUrl);
      if (metadata) {
        metadata.textContent =
          `${file.type} · ${formatBytes(file.size)} · ${dimensions.width} × ${dimensions.height}`;
      }
      selectedFile = file;
      updateUploadEnabled();
    } catch (error) {
      showPreviewFailure(error instanceof Error ? error.message : 'The image preview failed.');
    }
  };

  const encodedHeader = (value: string) => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  };

  const getCsrfToken = async () => {
    const response = await fetch('/admin/session-csrf', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = await response.json() as { csrfToken?: unknown };
    if (!response.ok || typeof payload.csrfToken !== 'string') {
      throw new Error('Could not verify this upload. Reload the page and try again.');
    }
    return payload.csrfToken;
  };

  const beginUpload = async () => {
    if (!selectedFile || !alt?.value.trim() || activeRequest) {
      if (alt && !alt.value.trim()) {
        setAltError('Describe the image for assistive technology.');
        alt.focus();
      }
      return;
    }
    if (uploadMessage) uploadMessage.textContent = 'Preparing a secure upload…';
    if (uploadButton) uploadButton.disabled = true;

    let csrfToken: string;
    try {
      csrfToken = await getCsrfToken();
    } catch (error) {
      if (uploadMessage) uploadMessage.textContent = error instanceof Error ? error.message : 'Upload could not be verified.';
      updateUploadEnabled();
      return;
    }

    const file = selectedFile;
    const xhr = new XMLHttpRequest();
    activeRequest = xhr;
    if (progressWrap) progressWrap.hidden = false;
    if (uploadCancel) uploadCancel.disabled = false;
    xhr.open('POST', '/admin/api/media');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    xhr.setRequestHeader('X-Media-Metadata', encodedHeader(JSON.stringify({
      filename: file.name,
      alt: alt.value.trim(),
    })));
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      progress?.setAttribute('aria-valuenow', String(percent));
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressLabel) progressLabel.textContent = `${percent}% · ${formatBytes(event.loaded)} of ${formatBytes(event.total)}`;
      if (uploadMessage) uploadMessage.textContent = 'Uploading to the private draft library…';
    };
    xhr.onload = () => {
      activeRequest = undefined;
      let payload: { media?: { id?: unknown }; error?: unknown };
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        payload = {};
      }
      if (xhr.status !== 201 || typeof payload.media?.id !== 'string') {
        if (uploadMessage) {
          uploadMessage.textContent = typeof payload.error === 'string'
            ? `Upload failed: ${payload.error}. Your local preview is retained.`
            : `Upload failed with status ${xhr.status}. Your local preview is retained.`;
        }
        updateUploadEnabled();
        return;
      }

      const imageUrl = `/admin/api/media?id=${encodeURIComponent(payload.media.id)}&image=1`;
      if (preview) {
        preview.onload = () => revokePreview();
        preview.onerror = () => {
          revokePreview();
          showPreviewFailure('The asset was saved, but its protected preview is unavailable. Check the library before retrying.');
        };
        preview.src = imageUrl;
      } else {
        revokePreview();
      }
      selectedFile = undefined;
      if (uploadMessage) uploadMessage.textContent = 'Upload confirmed. The asset is stored as a private draft and is not published.';
      if (viewLink) {
        viewLink.hidden = false;
        viewLink.href = `/admin/media?refresh=${Date.now()}#asset-${encodeURIComponent(payload.media.id)}`;
      }
      if (uploadButton) uploadButton.disabled = true;
      if (uploadCancel) uploadCancel.hidden = true;
    };
    xhr.onerror = () => {
      activeRequest = undefined;
      if (uploadMessage) uploadMessage.textContent = 'The upload connection failed. The local preview is retained; check the library before retrying.';
      updateUploadEnabled();
    };
    xhr.onabort = () => {
      activeRequest = undefined;
      if (uploadMessage) uploadMessage.textContent = 'Upload cancelled. If the connection ended during confirmation, check the library before retrying.';
      updateUploadEnabled();
    };
    xhr.onloadend = () => {
      if (!activeRequest && uploadCancel) uploadCancel.disabled = true;
      updateUploadEnabled();
    };
    xhr.send(file);
  };

  trigger?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void handleFile(file);
  });
  root.querySelectorAll<HTMLElement>('[data-selected-clear]').forEach((button) =>
    button.addEventListener('click', resetSelection)
  );
  uploadButton?.addEventListener('click', () => void beginUpload());
  uploadCancel?.addEventListener('click', () => activeRequest?.abort());
  alt?.addEventListener('input', () => {
    if (alt.value.trim()) setAltError('');
    updateUploadEnabled();
  });
  alt?.addEventListener('blur', () => {
    if (!alt.value.trim() && selectedFile) setAltError('Describe the image for assistive technology.');
  });

  ['dragenter', 'dragover'].forEach((type) =>
    dropzone?.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.dataset.drag = 'true';
    })
  );
  ['dragleave', 'dragend'].forEach((type) =>
    dropzone?.addEventListener(type, () => {
      if (dropzone) dropzone.dataset.drag = 'false';
    })
  );
  dropzone?.addEventListener('drop', (event) => {
    event.preventDefault();
    if (dropzone) dropzone.dataset.drag = 'false';
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  });

  root.querySelectorAll<HTMLImageElement>('[data-asset-image]').forEach((image) => {
    image.addEventListener('error', () => {
      image.hidden = true;
      const fallback = image.parentElement?.querySelector<HTMLElement>('[data-asset-fallback]');
      fallback?.removeAttribute('hidden');
    });
  });

  const requestMetadataUpdate = async (
    card: HTMLElement,
    payload: Record<string, unknown>,
  ) => {
    const csrfToken = await getCsrfToken();
    const response = await fetch('/admin/api/media', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        ...payload,
        id: card.dataset.id,
        expectedUpdatedAt: card.dataset.updatedAt,
      }),
    });
    const result = await response.json() as {
      media?: { updatedAt?: unknown; alt?: unknown };
      error?: unknown;
      detail?: unknown;
    };
    if (!response.ok || !result.media || typeof result.media.updatedAt !== 'string') {
      throw new Error(typeof result.detail === 'string'
        ? result.detail
        : typeof result.error === 'string' ? result.error : 'The media update could not be confirmed.');
    }
    card.dataset.updatedAt = result.media.updatedAt;
    return result.media;
  };

  root.querySelectorAll<HTMLElement>('[data-media-card]').forEach((card) => {
    const altInput = card.querySelector<HTMLTextAreaElement>('[data-alt-input]');
    const altSave = card.querySelector<HTMLButtonElement>('[data-alt-save]');
    const archiveButton = card.querySelector<HTMLButtonElement>('[data-archive-action]');
    const message = card.querySelector<HTMLElement>('[data-card-message]');
    const altValue = card.querySelector<HTMLElement>('[data-alt-value]');
    const initialAlt = altInput?.value.trim() ?? '';

    altInput?.addEventListener('input', () => {
      if (altSave) altSave.disabled = !altInput.value.trim() || altInput.value.trim() === initialAlt;
    });
    altSave?.addEventListener('click', async () => {
      if (!altInput || !altInput.value.trim()) {
        if (message) message.textContent = 'Alt text is required.';
        altInput?.focus();
        return;
      }
      altSave.disabled = true;
      if (message) message.textContent = 'Saving alt text…';
      try {
        const result = await requestMetadataUpdate(card, {
          action: 'update-alt',
          alt: altInput.value.trim(),
        });
        if (altValue && typeof result.alt === 'string') altValue.textContent = result.alt;
        if (message) message.textContent = 'Alt text saved.';
      } catch (error) {
        if (message) message.textContent = error instanceof Error ? error.message : 'Alt text could not be saved.';
        altSave.disabled = false;
      }
    });
    archiveButton?.addEventListener('click', async () => {
      const action = archiveButton.dataset.archiveAction;
      if (action === 'archive' && Number(archiveButton.dataset.references) > 0) {
        const confirmed = window.confirm(
          'This asset is referenced by draft or retained release content. Archiving does not delete it or break existing references, but removes it from new selections. Continue?',
        );
        if (!confirmed) return;
      }
      archiveButton.disabled = true;
      if (message) message.textContent = action === 'archive' ? 'Archiving asset…' : 'Restoring asset…';
      try {
        await requestMetadataUpdate(card, { action });
        if (message) message.textContent = action === 'archive' ? 'Asset archived. File retained.' : 'Asset restored.';
        window.setTimeout(() => window.location.reload(), 350);
      } catch (error) {
        if (message) message.textContent = error instanceof Error ? error.message : 'The media status could not be changed.';
        archiveButton.disabled = false;
      }
    });
  });
}
