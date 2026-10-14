/**
 * Admin editor runtime (Phase 11, Step A11.6).
 *
 * Shared, frontend-only behavior for the service and project editors:
 *
 *  - inline validation on blur (and live once a field is invalid),
 *  - character counters for fields with a real limit,
 *  - an unsaved-changes indicator and a leave guard,
 *  - local discard that restores initial values (including tag lists).
 *
 * It never saves or publishes anything: the editor action bar keeps those
 * controls disabled. This module only makes the local states truthful.
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
  const initialTags = serializeTags(root);

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

  // ---- Submit is never a save -------------------------------------------
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const results = validateAll();
    const firstInvalidIndex = results.indexOf(false);
    if (firstInvalidIndex >= 0) {
      controls[firstInvalidIndex]?.focus();
      return;
    }
    if (message) {
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
