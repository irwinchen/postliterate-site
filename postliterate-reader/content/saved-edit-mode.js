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
 * @param {(blocks: Element[]) => void} callbacks.onConfirm - Called with surviving blocks
 * @param {() => void} callbacks.onCancel - Called on cancel
 * @returns {{ destroy: () => void }} Cleanup handle
 */
export function enterSavedEditMode(blocks, articleContent, shadow, { onConfirm, onCancel }) {
  const removedBlocks = new Set();
  let activeControls = null;

  // Inject edit mode styles
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .pl-saved-edit .fr-hidden { display: block !important; visibility: visible !important; }
    .pl-saved-edit .fr-visible, .pl-saved-edit .fr-revealing {
      color: inherit !important; opacity: 1 !important; clip-path: none !important;
    }
    .pl-saved-edit-block { position: relative; transition: opacity 0.15s ease; }
    .pl-saved-edit-block.removed { opacity: 0.2; text-decoration: line-through; }
    .pl-saved-edit-controls {
      position: absolute; inset-block-start: 4px; inset-inline-end: 4px;
      display: flex; gap: 4px; z-index: 10;
    }
    .pl-saved-edit-btn {
      width: 24px; height: 24px; display: grid; place-items: center;
      background: var(--background); border: 1px solid var(--border-subtle);
      color: var(--text-secondary); cursor: pointer; font-size: 14px;
      line-height: 1;
    }
    .pl-saved-edit-btn:hover { color: var(--accent); border-color: var(--accent); }
    .pl-saved-edit-toolbar {
      position: fixed; inset-block-end: 0; inset-inline: 0;
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

  // Wrap each block for edit controls
  const wrappers = [];
  for (const block of blocks) {
    const wrapper = document.createElement('div');
    wrapper.className = 'pl-saved-edit-block';
    block.parentNode.insertBefore(wrapper, block);
    wrapper.appendChild(block);
    wrappers.push(wrapper);
  }

  // Count display
  const countEl = document.createElement('span');
  function updateCount() {
    const active = blocks.length - removedBlocks.size;
    countEl.textContent = `${active} block${active !== 1 ? 's' : ''} selected`;
  }
  updateCount();

  // Hover controls
  function removeControls() {
    if (activeControls) {
      activeControls.remove();
      activeControls = null;
    }
  }

  function showControls(wrapper, index) {
    removeControls();
    const controls = document.createElement('div');
    controls.className = 'pl-saved-edit-controls';

    const isRemoved = removedBlocks.has(index);

    if (isRemoved) {
      // Show "restore" button
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'pl-saved-edit-btn';
      restoreBtn.textContent = '+';
      restoreBtn.title = 'Restore block';
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removedBlocks.delete(index);
        wrapper.classList.remove('removed');
        updateCount();
        removeControls();
      });
      controls.appendChild(restoreBtn);
    } else {
      // Show "remove" button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'pl-saved-edit-btn';
      removeBtn.textContent = '\u00D7';
      removeBtn.title = 'Remove block';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removedBlocks.add(index);
        wrapper.classList.add('removed');
        updateCount();
        removeControls();
      });
      controls.appendChild(removeBtn);
    }

    wrapper.appendChild(controls);
    activeControls = controls;
  }

  // Hover listeners
  function onMouseOver(e) {
    const wrapper = e.target.closest('.pl-saved-edit-block');
    if (!wrapper) return;
    const index = wrappers.indexOf(wrapper);
    if (index >= 0) showControls(wrapper, index);
  }

  function onMouseOut(e) {
    const wrapper = e.target.closest('.pl-saved-edit-block');
    if (!wrapper || !wrapper.contains(e.relatedTarget)) {
      removeControls();
    }
  }

  articleContent.addEventListener('mouseover', onMouseOver);
  articleContent.addEventListener('mouseout', onMouseOut);

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
  shadow.appendChild(toolbar);

  // Cleanup function
  function destroy() {
    articleContent.removeEventListener('mouseover', onMouseOver);
    articleContent.removeEventListener('mouseout', onMouseOut);
    removeControls();
    articleContent.classList.remove('pl-saved-edit');

    // Unwrap blocks
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
