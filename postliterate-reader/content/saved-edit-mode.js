/**
 * Saved Edit Mode — block list editor for saved articles.
 *
 * Unlike the original-page edit mode, this works within the reading overlay
 * since there's no original page to map back to. Users can remove blocks
 * by hovering and clicking X. On confirm, surviving blocks are returned.
 */

/**
 * Enter saved edit mode on the article content area.
 *
 * @param {Element[]} blocks - Current block elements in the content area
 * @param {Element} articleContent - The article content container
 * @param {ShadowRoot} shadow - The shadow root for style injection
 * @param {Object} callbacks
 * @param {HTMLElement} [callbacks.readerRoot] - The reader root element for toolbar placement
 * @param {(blocks: Element[]) => void} callbacks.onConfirm - Called with surviving blocks
 * @param {() => void} callbacks.onCancel - Called on cancel
 * @returns {{ destroy: () => void }} Cleanup handle
 */
export function enterBlockEditMode(blocks, articleContent, shadow, { onConfirm, onCancel, readerRoot }) {
  const removedBlocks = new Set();

  // Inject edit mode styles
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .pl-saved-edit .fr-hidden { display: block !important; visibility: visible !important; }
    .pl-saved-edit .fr-visible, .pl-saved-edit .fr-revealing {
      color: inherit !important; opacity: 1 !important; clip-path: none !important;
    }
    .pl-saved-edit > * { overflow: visible !important; max-height: none !important; }
    .pl-saved-edit-block {
      position: relative;
      transition: opacity 0.15s ease;
      overflow: visible !important;
    }
    .pl-saved-edit-block.removed {
      opacity: 0.15;
    }
    .pl-saved-edit-block .pl-edit-x {
      position: absolute;
      inset-block-start: 2px;
      inset-inline-end: 4px;
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      background: var(--background);
      border: 1px solid var(--border-subtle);
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      z-index: 100;
      opacity: 0;
      transition: opacity 0.1s ease;
      pointer-events: none;
    }
    .pl-saved-edit-block:hover .pl-edit-x,
    .pl-saved-edit-block.removed .pl-edit-x {
      opacity: 1;
      pointer-events: auto;
    }
    .pl-saved-edit-block .pl-edit-x:hover {
      color: var(--accent);
      border-color: var(--accent);
    }
    .pl-saved-edit-toolbar {
      position: sticky; inset-block-end: 0;
      padding: 12px 24px; background: var(--background);
      border-block-start: 2px solid var(--accent);
      display: flex; align-items: center; justify-content: space-between;
      font-family: 'Outfit', sans-serif; font-size: 14px; z-index: 30;
    }
    .pl-saved-edit-toolbar button {
      font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 500;
      padding: 6px 16px; cursor: pointer; border: none;
    }
    .pl-saved-edit-toolbar .confirm {
      background: var(--accent); color: #fff;
    }
    .pl-saved-edit-toolbar .cancel {
      background: none; color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
    }
  `;
  shadow.appendChild(styleEl);

  // Mark content area as in edit mode (shows all blocks)
  articleContent.classList.add('pl-saved-edit');

  // Count display
  const countEl = document.createElement('span');
  function updateCount() {
    const active = blocks.length - removedBlocks.size;
    countEl.textContent = `${active} block${active !== 1 ? 's' : ''} selected`;
  }
  updateCount();

  // Wrap each block and add a persistent X button (shown/hidden via CSS :hover)
  const wrappers = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const wrapper = document.createElement('div');
    wrapper.className = 'pl-saved-edit-block';
    block.parentNode.insertBefore(wrapper, block);
    wrapper.appendChild(block);

    const btn = document.createElement('button');
    btn.className = 'pl-edit-x';
    btn.textContent = '\u00D7';
    btn.title = 'Remove block';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (removedBlocks.has(i)) {
        // Restore
        removedBlocks.delete(i);
        wrapper.classList.remove('removed');
        btn.textContent = '\u00D7';
        btn.title = 'Remove block';
      } else {
        // Remove
        removedBlocks.add(i);
        wrapper.classList.add('removed');
        btn.textContent = '+';
        btn.title = 'Restore block';
      }
      updateCount();
    });

    wrapper.appendChild(btn);
    wrappers.push(wrapper);
  }

  // Bottom toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pl-saved-edit-toolbar';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'confirm';
  confirmBtn.textContent = 'Done';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel';
  cancelBtn.textContent = 'Cancel';

  const btnGroup = document.createElement('div');
  btnGroup.style.display = 'flex';
  btnGroup.style.gap = '8px';
  btnGroup.append(cancelBtn, confirmBtn);

  toolbar.append(countEl, btnGroup);
  const toolbarParent = readerRoot || shadow.querySelector('.pl-reader-root') || shadow;
  toolbarParent.appendChild(toolbar);

  // Cleanup function
  function destroy() {
    articleContent.classList.remove('pl-saved-edit');

    // Unwrap blocks (remove wrapper divs, keep blocks)
    for (const wrapper of wrappers) {
      const block = wrapper.firstElementChild;
      if (block && wrapper.parentNode) {
        wrapper.parentNode.insertBefore(block, wrapper);
        wrapper.remove();
      }
    }

    styleEl.remove();
    toolbar.remove();
  }

  confirmBtn.addEventListener('click', () => {
    const surviving = blocks.filter((_, i) => !removedBlocks.has(i));
    destroy();
    onConfirm(surviving);
  });

  cancelBtn.addEventListener('click', () => {
    destroy();
    onCancel();
  });

  return { destroy };
}

// Backward-compatible alias
export { enterBlockEditMode as enterSavedEditMode };
