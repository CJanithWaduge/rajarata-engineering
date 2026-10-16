const roots = document.querySelectorAll<HTMLElement>('[data-draft-list]');

roots.forEach((root) => {
  const isService = Boolean(root.querySelector('#service-search'));
  const search = root.querySelector<HTMLInputElement>(isService ? '#service-search' : '#project-search');
  const category = root.querySelector<HTMLSelectElement>(
    isService ? '#service-category' : '#project-category',
  );
  const count = root.querySelector<HTMLElement>(isService ? '#service-count' : '#project-count');
  const noResults = root.querySelector<HTMLElement>(
    isService ? '#service-no-results' : '#project-no-results',
  );
  const records = Array.from(root.querySelectorAll<HTMLElement>('[data-draft-record]'));
  const status = document.createElement('p');
  status.className = 'font-body-sm text-body-sm text-on-surface';
  status.setAttribute('role', 'status');
  status.hidden = true;
  root.prepend(status);

  const filterRecords = () => {
    const query = (search?.value ?? '').trim().toLocaleLowerCase();
    const selectedCategory = category?.value ?? 'all';
    let visible = 0;
    records.forEach((record) => {
      const matchesText =
        (record.dataset.name ?? '').includes(query) ||
        (record.dataset.id ?? '').toLocaleLowerCase().includes(query);
      const matchesCategory =
        selectedCategory === 'all' || record.dataset.category === selectedCategory;
      record.hidden = !matchesText || !matchesCategory;
      if (!record.hidden) visible += 1;
    });
    if (count) count.textContent = String(visible);
    if (noResults) noResults.hidden = visible !== 0;
  };

  search?.addEventListener('input', filterRecords);
  category?.addEventListener('change', filterRecords);

  root.querySelectorAll<HTMLButtonElement>('[data-draft-archive]').forEach((button) => {
    button.addEventListener('click', async () => {
      const kind = button.dataset.kind;
      const action = button.dataset.action;
      const id = button.dataset.id;
      const expectedUpdatedAt = button.dataset.updatedAt;
      if (
        (kind !== 'services' && kind !== 'projects') ||
        (action !== 'archive' && action !== 'restore') ||
        !id ||
        !expectedUpdatedAt
      ) {
        status.textContent = 'This draft action is not configured correctly.';
        status.hidden = false;
        return;
      }
      if (!window.confirm(`${action === 'archive' ? 'Archive' : 'Restore'} draft ${id}?`)) return;

      button.disabled = true;
      status.textContent = `${action === 'archive' ? 'Archiving' : 'Restoring'} draft…`;
      status.hidden = false;
      try {
        const csrfResponse = await fetch('/admin/session-csrf', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const csrfPayload = await csrfResponse.json() as { csrfToken?: unknown };
        if (!csrfResponse.ok || typeof csrfPayload.csrfToken !== 'string') {
          throw new Error('Could not verify this request. Reload the page and try again.');
        }
        const response = await fetch('/admin/api/drafts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfPayload.csrfToken,
          },
          body: JSON.stringify({ kind, action, id, expectedUpdatedAt }),
        });
        const result = await response.json() as { error?: string; detail?: string };
        if (!response.ok) {
          throw new Error(result.detail ?? result.error ?? 'The draft action failed.');
        }
        window.location.reload();
      } catch (error) {
        status.textContent = error instanceof Error
          ? error.message
          : 'The draft action failed. Try again.';
        button.disabled = false;
      }
    });
  });
});
