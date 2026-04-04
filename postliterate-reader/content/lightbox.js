/**
 * Lightbox — click a figure or image in the article to view it full-height.
 * Appended inside the reader root container so z-index stacking works.
 *
 * @param {HTMLElement} container - The reader root element (or shadow root)
 * @param {HTMLElement} articleContent - The article content container
 * @returns {{ destroy: () => void }}
 */
export function setupLightbox(container, articleContent) {
  // — Build overlay (hidden until open)
  const overlay = document.createElement('div');
  overlay.className = 'pl-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Image viewer');

  const img = document.createElement('img');
  img.className = 'pl-lightbox-img';
  img.alt = '';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pl-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close image viewer');
  closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="1" y1="1" x2="17" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="17" y1="1" x2="1" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

  overlay.append(img, closeBtn);
  container.appendChild(overlay);

  // — State
  let isOpen = false;

  function open(src, alt) {
    img.src = src;
    img.alt = alt || '';
    overlay.style.display = 'grid';

    // Force reflow so transition fires
    overlay.getBoundingClientRect();
    overlay.classList.add('pl-lightbox-open');
    isOpen = true;
    closeBtn.focus();
  }

  // If the lightbox image fails to load, close it
  img.addEventListener('error', () => {
    if (isOpen) close();
  });

  function close() {
    if (!isOpen) return;
    overlay.classList.remove('pl-lightbox-open');
    isOpen = false;
    // Hide after transition completes
    overlay.addEventListener('transitionend', () => {
      if (!isOpen) overlay.style.display = 'none';
    }, { once: true });
  }

  /**
   * Get the best available image URL from an img element.
   * Prefers srcset (highest resolution), then data-src, then src.
   */
  function getBestSrc(imgEl) {
    // Check srcset for highest resolution
    if (imgEl.srcset) {
      const candidates = imgEl.srcset.split(',').map((s) => {
        const parts = s.trim().split(/\s+/);
        const url = parts[0];
        const descriptor = parts[1] || '';
        const w = descriptor.endsWith('w') ? parseInt(descriptor) : 0;
        return { url, w };
      });
      candidates.sort((a, b) => b.w - a.w);
      if (candidates[0]?.url) return candidates[0].url;
    }
    // Check data-src (lazy-loaded images)
    if (imgEl.dataset.src) return imgEl.dataset.src;
    // Check data-lazy-src
    if (imgEl.dataset.lazySrc) return imgEl.dataset.lazySrc;
    // Fall back to src
    return imgEl.src;
  }

  // — Click on figure or img inside article content
  function handleArticleClick(e) {
    const target = e.target;

    // Direct click on an img
    if (target.tagName === 'IMG') {
      const src = getBestSrc(target);
      if (src) {
        e.stopPropagation();
        open(src, target.alt);
      }
      return;
    }

    // Click on a figure or anything inside a figure — find its img
    const figure = target.closest('figure');
    if (figure) {
      const imgEl = figure.querySelector('img');
      if (imgEl) {
        const src = getBestSrc(imgEl);
        if (src) {
          e.stopPropagation();
          open(src, imgEl.alt);
        }
      }
    }
  }

  // — Close triggers
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close(); // click backdrop
  });

  function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation(); // don't bubble to reader's own Escape handler
      close();
    }
  }

  articleContent.addEventListener('click', handleArticleClick);
  document.addEventListener('keydown', handleKeydown, true); // capture so it fires first

  return {
    destroy() {
      articleContent.removeEventListener('click', handleArticleClick);
      document.removeEventListener('keydown', handleKeydown, true);
      overlay.remove();
    },
  };
}
