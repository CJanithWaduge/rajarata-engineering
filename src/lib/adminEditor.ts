/**
 * Admin editor runtime (Phase 11, Step A11.6).
 *
 * Shared behavior for the service and project editors:
 *
 *  - inline validation on blur (and live once a field is invalid),
 *  - character counters for fields with a real limit,
 *  - an unsaved-changes indicator and a leave guard,
 *  - discard that restores initial values (including tag lists),
 *  - emulator-only draft persistence with optimistic concurrency.
 *
 * Draft writes never publish content or alter the static public site.
 */

interface EditorForm extends HTMLFormElement {
  __editorDirty?: () => boolean;
}

const TAG_RESET_EVENT = 'taginput:reset';

const isEditable = (el: HTMLElement): boolean => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.disabled) return false;
    if (el instanceof HTMLInputElement && (el.type === 'hidden' || el.type === 'button' || el.type === 'submit')) {
      return false;
    }
    if (el.hasAttribute('data-tag-field')) return false; // tag entry, not a persisted value
    return true;
  }
  return false;
};

const valueOf = (el: HTMLElement): string => {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'on' : 'off';
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
  return '';
};

const serializeTags = (root: HTMLElement): string =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-tag-input]'))
    .map((wrap) =>
      Array.from(wrap.querySelectorAll('[data-tag-list] li span:first-child'))
        .map((span) => span.textContent?.trim() ?? '')
        .join('|')
    )
    .join('#');

const dirtyForms = new Set<EditorForm>();

const initEditor = (form: EditorForm) => {
  const root = (form.closest('[data-editor-root]') as HTMLElement | null) ?? form;
  const dirtyLabel = root.querySelector<HTMLElement>('[data-editor-dirty-label]');
  const dirtyIcon = root.querySelector<HTMLElement>('[data-editor-dirty-icon]');
  const discardBtn = root.querySelector<HTMLButtonElement>('[data-editor-discard]');
  const message = root.querySelector<HTMLElement>('[data-editor-message]');

  const controls = Array.from(form.querySelectorAll<HTMLElement>('input, textarea, select')).filter(
    isEditable
  );

  const initialValues = new Map<HTMLElement, string>();
  controls.forEach((control) => initialValues.set(control, valueOf(control)));
  let initialTags = serializeTags(root);

  const computeDirty = () => {
    const changedControl = controls.some((control) => valueOf(control) !== initialValues.get(control));
    return changedControl || serializeTags(root) !== initialTags;
  };

  const setDirty = (next: boolean) => {
    form.dataset.dirty = String(next);
    if (next) dirtyForms.add(form);
    else dirtyForms.delete(form);

    if (dirtyLabel) {
      dirtyLabel.textContent = next ? 'Unsaved local changes' : 'No unsaved changes';
      dirtyLabel.classList.toggle('text-primary-container', next);
      dirtyLabel.classList.toggle('text-secondary', !next);
    }
    if (dirtyIcon) dirtyIcon.textContent = next ? 'edit_note' : 'cloud_off';
    if (discardBtn) discardBtn.disabled = !next;
  };

  const refreshDirty = () => setDirty(computeDirty());

  form.__editorDirty = computeDirty;

  // ---- Counters ----------------------------------------------------------
  root.querySelectorAll<HTMLElement>('[data-counter-for]').forEach((counterEl) => {
    const sourceId = counterEl.dataset.counterFor;
    const target = counterEl.querySelector<HTMLElement>('[data-counter-value]');
    if (!sourceId || !target) return;
    const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${CSS.escape(sourceId)}`);
    if (!input) return;
    const sync = () => {
      target.textContent = String(input.value.length);
    };
    input.addEventListener('input', sync);
    sync();
  });

  // ---- Validation --------------------------------------------------------
  const errorElFor = (control: HTMLElement) => {
    const field = control.closest('[data-field]');
    return field ? field.querySelector<HTMLElement>('[id$="-error"]') : null;
  };

  const setError = (control: HTMLElement, text: string) => {
    const errorEl = errorElFor(control);
    control.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (errorEl) {
      errorEl.textContent = text;
      errorEl.classList.toggle('hidden', !text);
    }
  };

  const validate = (control: HTMLElement): boolean => {
    if (!control.hasAttribute('required')) {
      setError(control, '');
      return true;
    }
    const value = valueOf(control).trim();
    let text = '';
    if (!value) {
      text = control.dataset.requiredMessage || 'This field is required.';
    } else if (control instanceof HTMLInputElement && control.type === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) text = 'Enter a valid email address.';
    } else if (control instanceof HTMLInputElement && control.type === 'url') {
      if (!/^https?:\/\/.+/i.test(value)) text = 'Enter a full URL beginning with https://';
    }
    setError(control, text);
    return !text;
  };

  const validateAll = () => controls.map(validate);

  controls.forEach((control) => {
    control.addEventListener('blur', () => {
      validate(control);
    });
    control.addEventListener('input', () => {
      refreshDirty();
      // Only re-validate once a field has already been marked invalid, so the
      // form does not shout at someone who is still typing.
      if (control.getAttribute('aria-invalid') === 'true') validate(control);
    });
    control.addEventListener('change', () => {
      refreshDirty();
      if (control.getAttribute('aria-invalid') === 'true') validate(control);
    });
  });

  root.addEventListener('taginput:change', refreshDirty);

  // ---- Discard -----------------------------------------------------------
  const discard = () => {
    form.reset();
    controls.forEach((control) => {
      const initial = initialValues.get(control);
      if (initial !== undefined && control instanceof HTMLInputElement) {
        if (control.type === 'checkbox' || control.type === 'radio') control.checked = control.defaultChecked;
        else control.value = initial;
      } else if (initial !== undefined && control instanceof HTMLTextAreaElement) {
        control.value = initial;
      } else if (initial !== undefined && control instanceof HTMLSelectElement) {
        control.value = initial;
      }
      setError(control, '');
    });
    root.querySelectorAll<HTMLElement>('[data-tag-input]').forEach((wrap) =>
      wrap.dispatchEvent(new CustomEvent(TAG_RESET_EVENT, { bubbles: false }))
    );
    root.querySelectorAll<HTMLElement>('[data-counter-for]').forEach((counterEl) => {
      const sourceId = counterEl.dataset.counterFor;
      const target = counterEl.querySelector<HTMLElement>('[data-counter-value]');
      const input = sourceId
        ? root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${CSS.escape(sourceId)}`)
        : null;
      if (input && target) target.textContent = String(input.value.length);
    });
    refreshDirty();
  };

  discardBtn?.addEventListener('click', discard);

  const saveDraft = async () => {
    const kind = form.dataset.draftKind;
    const message = root.querySelector<HTMLElement>('[data-editor-message]');
    const saveButton = root.querySelector<HTMLButtonElement>('[data-editor-save]');
    if (!kind || !message || !saveButton) return;

    const fields = new FormData(form);
    const stringField = (name: string) => String(fields.get(name) ?? '');
    const tags = (name: string) => {
      const list = root.querySelector<HTMLElement>(`[data-tag-name="${CSS.escape(name)}"] [data-tag-list]`);
      return Array.from(list?.querySelectorAll('li span:first-child') ?? [])
        .map((item) => item.textContent?.trim() ?? '')
        .filter(Boolean);
    };
    const updatedAt = form.dataset.expectedUpdatedAt;
    const expectedUpdatedAt = updatedAt === 'null' ? null : updatedAt;
    if (expectedUpdatedAt === undefined) {
      message.textContent = 'The draft version is missing. Reload this editor before saving.';
      message.classList.remove('hidden');
      message.focus();
      return;
    }

    const expectedFor = (key: string): string | null | undefined => {
      const value = form.dataset[key];
      return value === 'null' ? null : value;
    };
    const draftForPage = (
      pageId: string,
      sections: Record<string, unknown>,
      version: string | null,
    ) => ({
      schemaVersion: 1,
      pageId,
      sections,
      updatedAt: version ?? now,
    });
    let draft: Record<string, unknown>;
    const now = new Date().toISOString();
    let siteTasks: Array<{
      kind: string;
      expectedUpdatedAt: string | null;
      draft: Record<string, unknown>;
    }> = [];
    if (kind === 'services') {
      draft = {
        schemaVersion: 1,
        id: stringField('id'),
        order: Number(stringField('order')),
        category: stringField('category'),
        title: stringField('title'),
        summary: stringField('summary'),
        body: stringField('description'),
        scope: stringField('scope'),
        suitability: tags('suitableFor'),
        imageRef: stringField('imageRef') || null,
        archived: stringField('archived') === 'true',
        updatedAt: expectedUpdatedAt ?? now,
      };
    } else if (kind === 'projects') {
      const year = stringField('year').trim();
      draft = {
        schemaVersion: 1,
        id: stringField('id'),
        order: Number(stringField('order')),
        category: stringField('type'),
        title: stringField('title'),
        summary: stringField('summary'),
        specifications: stringField('description'),
        location: stringField('location'),
        year: year ? Number(year) : null,
        reference: stringField('id'),
        clientName: stringField('client').trim() || null,
        imageRef: stringField('imageRef') || null,
        altText: stringField('alt'),
        featured: root.querySelector<HTMLInputElement>('[name="featured"]')?.checked ?? false,
        archived: stringField('archived') === 'true',
        updatedAt: expectedUpdatedAt ?? now,
      };
    } else if (kind === 'siteContent') {
      const homeVersion = expectedFor('expectedHome');
      const aboutVersion = expectedFor('expectedAbout');
      const contactVersion = expectedFor('expectedContact');
      const businessVersion = expectedFor('expectedBusiness');
      const seoVersion = expectedFor('expectedSeo');
      if (
        homeVersion === undefined ||
        aboutVersion === undefined ||
        contactVersion === undefined ||
        businessVersion === undefined ||
        seoVersion === undefined
      ) {
        message.textContent = 'Draft versions are missing. Reload this editor before saving.';
        message.classList.remove('hidden');
        message.focus();
        return;
      }
      const routes: Record<string, unknown> = {};
      for (const route of ['home', 'services', 'projects', 'about', 'contact']) {
        routes[route] = {
          title: stringField(`seo-title-${route}`),
          description: stringField(`seo-description-${route}`),
          shareImageRef: stringField(`seo-share-image-${route}`) || null,
        };
      }
      siteTasks = [
        {
          kind: 'pages',
          expectedUpdatedAt: homeVersion,
          draft: draftForPage('home', {
            hero: {
              heading: stringField('home-heroHeading'),
              intro: stringField('home-heroIntro'),
              ctaLabel: stringField('home-heroCta'),
              ctaTarget: '/contact',
            },
            trustStrip: { items: tags('home-trustStrip') },
          }, homeVersion),
        },
        {
          kind: 'pages',
          expectedUpdatedAt: aboutVersion,
          draft: draftForPage('about', {
            hero: { intro: stringField('about-intro') },
            heritage: { body: stringField('about-story') },
            visionMission: {
              heading: stringField('about-vision'),
              body: stringField('about-mission'),
            },
            industries: { items: tags('about-industries') },
            pillars: { items: tags('about-pillars') },
            methodology: { body: stringField('about-process') },
            cta: { body: stringField('about-cta') },
          }, aboutVersion),
        },
        {
          kind: 'pages',
          expectedUpdatedAt: contactVersion,
          draft: draftForPage('contact', {
            operationalDesks: {
              label: stringField('contact-deskLabel'),
              body: stringField('contact-deskDetails'),
            },
            quotation: { body: stringField('contact-support') },
            visitorInformation: { body: stringField('contact-visitor') },
          }, contactVersion),
        },
        {
          kind: 'businessDetails',
          expectedUpdatedAt: businessVersion,
          draft: {
            schemaVersion: 1,
            address: stringField('business-address'),
            phone: stringField('business-phone'),
            email: stringField('business-email'),
            hours: stringField('business-hours'),
            whatsapp: stringField('business-whatsapp'),
            updatedAt: businessVersion ?? now,
          },
        },
        {
          kind: 'seo',
          expectedUpdatedAt: seoVersion,
          draft: {
            schemaVersion: 1,
            routes,
            updatedAt: seoVersion ?? now,
          },
        },
      ];
      draft = {};
    } else {
      return;
    }

    saveButton.disabled = true;
    const originalLabel = saveButton.textContent;
    saveButton.textContent = 'Saving draft…';
    message.classList.add('hidden');

    let savedSiteTasks = 0;
    let latestUpdatedAt: string | undefined;
    try {
      const csrfResponse = await fetch('/admin/session-csrf', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const csrfPayload = await csrfResponse.json() as { csrfToken?: unknown };
      if (!csrfResponse.ok || typeof csrfPayload.csrfToken !== 'string') {
        throw new Error('Could not verify this request. Reload the page and try again.');
      }
      const csrfToken = csrfPayload.csrfToken;

      const saveOne = async (
        saveKind: string,
        saveExpectedUpdatedAt: string | null,
        saveDraftValue: Record<string, unknown>,
      ) => {
        const response = await fetch('/admin/api/drafts', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({
            kind: saveKind,
            action: 'save',
            expectedUpdatedAt: saveExpectedUpdatedAt,
            draft: saveDraftValue,
          }),
        });
        const payload = await response.json() as {
          draft?: { id?: string; updatedAt?: string };
          error?: string;
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(payload.detail ?? payload.error ?? 'The draft could not be saved.');
        }
        return payload;
      };

      if (kind === 'siteContent') {
        for (const task of siteTasks) {
          const result = await saveOne(task.kind, task.expectedUpdatedAt, task.draft);
          const key = task.kind === 'pages'
            ? String(task.draft.pageId)
            : task.kind === 'businessDetails' ? 'business' : 'seo';
          if (typeof result.draft?.updatedAt === 'string') {
            form.dataset[`expected${key[0]?.toUpperCase()}${key.slice(1)}`] = result.draft.updatedAt;
          }
          latestUpdatedAt = result.draft?.updatedAt;
          savedSiteTasks += 1;
        }
        message.textContent = 'Draft content saved. The public site has not changed.';
      } else {
        const result = await saveOne(kind, expectedUpdatedAt, draft);
        latestUpdatedAt = result.draft?.updatedAt;
        if (expectedUpdatedAt === null && typeof result.draft?.id === 'string') {
          const path = kind === 'services' ? '/admin/services/edit' : '/admin/projects/edit';
          window.location.assign(`${path}?id=${encodeURIComponent(result.draft.id)}`);
          return;
        }
        message.textContent = 'Draft saved. The public site has not changed.';
      }
      message.classList.remove('hidden');
      initialValues.clear();
      controls.forEach((control) => initialValues.set(control, valueOf(control)));
      initialTags = serializeTags(root);
      if (latestUpdatedAt) {
        form.dataset.expectedUpdatedAt = latestUpdatedAt;
      }
      setDirty(false);
    } catch (error) {
      message.textContent = error instanceof Error
        ? savedSiteTasks > 0
          ? `${savedSiteTasks} of ${siteTasks.length} drafts saved before an error: ${error.message} Reload to review the saved versions.`
          : error.message
        : 'The draft could not be saved. Try again.';
      message.classList.remove('hidden');
      message.setAttribute('tabindex', '-1');
      message.focus();
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = originalLabel;
    }
  };

  root.querySelector<HTMLButtonElement>('[data-editor-save]')?.addEventListener('click', () => {
    const results = validateAll();
    const firstInvalidIndex = results.indexOf(false);
    if (firstInvalidIndex >= 0) {
      controls[firstInvalidIndex]?.focus();
      return;
    }
    void saveDraft();
  });

  // ---- Submit validates; persistence is an explicit button action --------
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const results = validateAll();
    const firstInvalidIndex = results.indexOf(false);
    if (firstInvalidIndex >= 0) {
      controls[firstInvalidIndex]?.focus();
      return;
    }
    if (form.dataset.draftKind) {
      void saveDraft();
    } else if (message) {
      message.textContent =
        'Saving is unavailable. Content storage and the publishing pipeline are not connected, so nothing was stored or published.';
      message.classList.remove('hidden');
      message.setAttribute('tabindex', '-1');
      message.focus();
    }
  });

  setDirty(false);
};

const initAll = () => {
  document.querySelectorAll<EditorForm>('[data-editor-form]').forEach(initEditor);
};

window.addEventListener('beforeunload', (event) => {
  let dirty = false;
  dirtyForms.forEach((form) => {
    if (form.__editorDirty?.()) dirty = true;
  });
  if (dirty) {
    event.preventDefault();
    // Legacy property kept for older browsers; the modern path is preventDefault().
    (event as unknown as { returnValue: string }).returnValue = '';
  }
});

initAll();
