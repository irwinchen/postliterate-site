import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEditOverlay } from '../content/edit-mode-ui.js';

describe('createEditOverlay', () => {
  let page;
  let selectedIds;

  beforeEach(() => {
    document.body.innerHTML = `
      <article>
        <h1 data-pl-id="0">Title</h1>
        <p data-pl-id="1">First paragraph.</p>
        <p data-pl-id="2">Second paragraph.</p>
        <div data-pl-id="3">Ad content</div>
        <p data-pl-id="4">Third paragraph.</p>
      </article>
    `;
    page = document.body;
    selectedIds = new Set(['0', '1', '2', '4']);
  });

  it('creates a scrim element on the page', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    const scrim = document.querySelector('.pl-edit-scrim');
    expect(scrim).not.toBeNull();
    overlay.destroy();
  });

  it('creates a bottom toolbar with block count', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    const toolbar = document.querySelector('.pl-edit-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar.textContent).toContain('4');
    overlay.destroy();
  });

  it('marks selected elements with pl-edit-selected class', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    const selected = document.querySelectorAll('.pl-edit-selected');
    expect(selected).toHaveLength(4);
    overlay.destroy();
  });

  it('does not mark unselected elements', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    const ad = page.querySelector('[data-pl-id="3"]');
    expect(ad.classList.contains('pl-edit-selected')).toBe(false);
    overlay.destroy();
  });

  it('calls onConfirm with assembled blocks when Read is clicked', () => {
    const onConfirm = vi.fn();
    const overlay = createEditOverlay({ page, selectedIds, onConfirm, onCancel: vi.fn() });
    const readBtn = document.querySelector('.pl-edit-read-btn');
    readBtn.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toHaveLength(4);
    overlay.destroy();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel });
    const cancelBtn = document.querySelector('.pl-edit-cancel-btn');
    cancelBtn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    overlay.destroy();
  });

  it('resets selection when Reset is clicked', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    // Remove an element
    const p1 = page.querySelector('[data-pl-id="1"]');
    overlay.removeElement(p1);
    expect(document.querySelectorAll('.pl-edit-selected')).toHaveLength(3);

    // Reset
    const resetBtn = document.querySelector('.pl-edit-reset-btn');
    resetBtn.click();
    expect(document.querySelectorAll('.pl-edit-selected')).toHaveLength(4);
    overlay.destroy();
  });

  it('removeElement updates block count in toolbar', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    const p1 = page.querySelector('[data-pl-id="1"]');
    overlay.removeElement(p1);
    const toolbar = document.querySelector('.pl-edit-toolbar');
    expect(toolbar.textContent).toContain('3');
    overlay.destroy();
  });

  it('addElement adds a new element and updates count', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    const ad = page.querySelector('[data-pl-id="3"]');
    overlay.addElement(ad);
    expect(ad.classList.contains('pl-edit-selected')).toBe(true);
    const toolbar = document.querySelector('.pl-edit-toolbar');
    expect(toolbar.textContent).toContain('5');
    overlay.destroy();
  });

  it('destroy removes all overlay elements and classes', () => {
    const overlay = createEditOverlay({ page, selectedIds, onConfirm: vi.fn(), onCancel: vi.fn() });
    overlay.destroy();
    expect(document.querySelector('.pl-edit-scrim')).toBeNull();
    expect(document.querySelector('.pl-edit-toolbar')).toBeNull();
    expect(document.querySelectorAll('.pl-edit-selected')).toHaveLength(0);
  });
});
