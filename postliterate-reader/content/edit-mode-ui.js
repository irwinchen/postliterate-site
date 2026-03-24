/**
 * Edit Mode UI — renders the scrim overlay, hover controls, and toolbar
 * for refining Readability's extraction on the original page.
 */

import { EditMode } from './edit-mode.js';

/**
 * Create and mount the edit mode overlay.
 *
 * @param {Object} options
 * @param {Element} options.page - The root element (document.body)
 * @param {Set<string>} options.selectedIds - data-pl-id values from Readability
 * @param {Function} options.onConfirm - Called with assembled block elements
 * @param {Function} options.onCancel - Called when user cancels
 * @returns {{ destroy: Function, addElement: Function, removeElement: Function }}
 */
export function createEditOverlay({ page, selectedIds, onConfirm, onCancel }) {
  const mode = new EditMode(page, selectedIds);

  // — Scrim
  const scrim = document.createElement('div');
  scrim.className = 'pl-edit-scrim';
  Object.assign(scrim.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0, 0, 0, 0.5)',
    zIndex: '2147483640',
    pointerEvents: 'none',
  });
  document.body.appendChild(scrim);

  // — Apply selected class to initial selection
  function syncClasses() {
    // Clear all first
    for (const el of page.querySelectorAll('.pl-edit-selected')) {
      el.classList.remove('pl-edit-selected');
    }
    for (const el of mode.selectedElements) {
      el.classList.add('pl-edit-selected');
    }
  }
  syncClasses();

  // — Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pl-edit-toolbar';
  Object.assign(toolbar.style, {
    position: 'fixed',
    insetBlockEnd: '0',
    insetInline: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: '#1a1a1a',
    color: '#fff',
    fontFamily: 'Outfit, system-ui, sans-serif',
    fontSize: '14px',
    zIndex: '2147483646',
  });

  const countSpan = document.createElement('span');
  countSpan.className = 'pl-edit-count';

  function updateCount() {
    countSpan.textContent = `${mode.getBlockCount()} blocks selected`;
  }
  updateCount();

  const readBtn = document.createElement('button');
  readBtn.className = 'pl-edit-read-btn';
  readBtn.textContent = 'Read';
  Object.assign(readBtn.style, {
    padding: '6px 16px',
    background: '#E53E33',
    color: '#fff',
    border: 'none',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  });

  const resetBtn = document.createElement('button');
  resetBtn.className = 'pl-edit-reset-btn';
  resetBtn.textContent = 'Reset';
  Object.assign(resetBtn.style, {
    padding: '6px 16px',
    background: 'transparent',
    color: '#fff',
    border: '1px solid #666',
    fontFamily: 'inherit',
    fontSize: '14px',
    cursor: 'pointer',
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'pl-edit-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  Object.assign(cancelBtn.style, {
    padding: '6px 16px',
    background: 'transparent',
    color: '#999',
    border: 'none',
    fontFamily: 'inherit',
    fontSize: '14px',
    cursor: 'pointer',
  });

  toolbar.append(countSpan, readBtn, resetBtn, cancelBtn);
  document.body.appendChild(toolbar);

  // — Event handlers
  readBtn.addEventListener('click', () => {
    const blocks = mode.assemble();
    onConfirm(blocks);
  });

  resetBtn.addEventListener('click', () => {
    mode.reset();
    syncClasses();
    updateCount();
  });

  cancelBtn.addEventListener('click', () => {
    onCancel();
  });

  // — Public API
  function addElement(el) {
    mode.add(el);
    el.classList.add('pl-edit-selected');
    updateCount();
  }

  function removeElement(el) {
    mode.remove(el);
    el.classList.remove('pl-edit-selected');
    updateCount();
  }

  function destroy() {
    scrim.remove();
    toolbar.remove();
    for (const el of page.querySelectorAll('.pl-edit-selected')) {
      el.classList.remove('pl-edit-selected');
    }
  }

  return { destroy, addElement, removeElement, mode };
}
