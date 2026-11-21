/**
 * HORA — Artwork Zoom & Pan Engine
 *
 * - Mobile / Touch: Two-finger focal-point pinch-to-zoom (up to 4x) that
 *   springs smoothly back to 100% on finger release without zooming the page.
 * - Desktop / Larger Screens: Bottom-right translucent zoom bar (100%–400%),
 *   drag-to-pan with edge clamping, trackpad pinch, double-click zoom, and
 *   keyboard shortcuts (+, -, 0).
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampZoom(scale, min = MIN_ZOOM, max = MAX_ZOOM) {
  if (!Number.isFinite(scale)) return min;
  return clamp(scale, min, max);
}

/**
 * Clamps translation (tx, ty) in screen pixels so the zoomed artwork never
 * drifts away from the viewport edges.
 */
export function clampPan(tx, ty, { scale, baseWidth, baseHeight, viewportWidth, viewportHeight }) {
  if (!Number.isFinite(scale) || scale <= 1) {
    return { tx: 0, ty: 0 };
  }
  const maxX = Math.max(0, (baseWidth * scale - viewportWidth) / 2);
  const maxY = Math.max(0, (baseHeight * scale - viewportHeight) / 2);
  return {
    tx: clamp(Number.isFinite(tx) ? tx : 0, -maxX, maxX),
    ty: clamp(Number.isFinite(ty) ? ty : 0, -maxY, maxY),
  };
}

/**
 * Computes new (tx, ty) so the artwork point currently under (focalX, focalY)
 * — measured relative to the artwork center — stays anchored when zooming from
 * `currentScale` to `nextScale`.
 */
export function computeFocalZoomPan({
  currentScale,
  nextScale,
  currentTx = 0,
  currentTy = 0,
  focalX = 0,
  focalY = 0,
}) {
  if (!Number.isFinite(currentScale) || currentScale <= 0 || nextScale <= 1) {
    return { tx: 0, ty: 0 };
  }
  const ratio = nextScale / currentScale;
  return {
    tx: focalX - (focalX - currentTx) * ratio,
    ty: focalY - (focalY - currentTy) * ratio,
  };
}

/**
 * Computes scale and focal-point pan for a two-finger touch pinch relative to
 * the artwork center.
 */
export function computePinchTransform({
  startDist,
  currentDist,
  startMidX,
  startMidY,
  currentMidX,
  currentMidY,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
}) {
  const safeStart = Math.max(10, startDist || 10);
  const scale = clampZoom(currentDist / safeStart, minZoom, maxZoom);
  const tx = currentMidX - scale * startMidX;
  const ty = currentMidY - scale * startMidY;
  return { scale, tx, ty };
}

/**
 * Creates the interactive zoom/pan controller bound to the gallery DOM.
 */
export function createZoomController({
  viewport,
  stage,
  frame,
  image,
  controlWrap,
  toggleBtn,
  toggleLabel,
  slider,
  outBtn,
  inBtn,
  percentBtn,
  collapseBtn,
  isOverlayOpen,
  onActivity,
}) {
  let scale = MIN_ZOOM;
  let tx = 0;
  let ty = 0;
  let isExpanded = false;

  // Desktop mouse drag-to-pan state
  let isDragging = false;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginTx = 0;
  let dragOriginTy = 0;

  // Mobile two-finger pinch state (Instagram-style snap-back)
  let isPinching = false;
  let pinchStartDist = 0;
  let pinchStartMidX = 0;
  let pinchStartMidY = 0;
  let lastPinchEndTime = 0;

  // Snap-back transition cleanup timer
  let transitionTimer = null;

  function getMetrics() {
    const vpRect = viewport.getBoundingClientRect();
    return {
      viewportWidth: vpRect.width || window.innerWidth,
      viewportHeight: vpRect.height || window.innerHeight,
      centerX: vpRect.left + vpRect.width / 2,
      centerY: vpRect.top + vpRect.height / 2,
      baseWidth: image.offsetWidth || vpRect.width,
      baseHeight: image.offsetHeight || vpRect.height,
    };
  }

  function applyTransform({ animate = false } = {}) {
    clearTimeout(transitionTimer);
    if (animate) {
      frame.classList.add('is-zoom-animating');
      transitionTimer = setTimeout(() => {
        frame.classList.remove('is-zoom-animating');
      }, 340);
    } else {
      frame.classList.remove('is-zoom-animating');
    }

    if (scale === 1 && tx === 0 && ty === 0) {
      frame.style.transform = '';
    } else {
      frame.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
    }

    const zoomed = scale > 1.001;
    viewport.classList.toggle('is-zoomed', zoomed);
    viewport.classList.toggle('is-pinching', isPinching);
    viewport.classList.toggle('is-panning', isDragging);
    syncControlsUI();
  }

  function syncControlsUI() {
    const pct = Math.round(scale * 100);
    slider.value = String(pct);
    percentBtn.textContent = `${pct}%`;
    outBtn.disabled = scale <= MIN_ZOOM + 0.001;
    inBtn.disabled = scale >= MAX_ZOOM - 0.001;

    controlWrap.classList.toggle('is-expanded', isExpanded);
    toggleBtn.setAttribute('aria-expanded', String(isExpanded));

    if (scale > 1.001) {
      toggleLabel.textContent = `${pct}%`;
      toggleBtn.classList.add('has-zoom-badge');
    } else {
      toggleLabel.textContent = '';
      toggleBtn.classList.remove('has-zoom-badge');
    }
  }

  function setExpanded(next) {
    isExpanded = Boolean(next);
    syncControlsUI();
    onActivity?.();
  }

  function setZoom(nextScale, { focalX = 0, focalY = 0, animate = false, expandBar = false } = {}) {
    const clamped = clampZoom(nextScale, MIN_ZOOM, MAX_ZOOM);
    const metrics = getMetrics();

    if (clamped <= 1.001) {
      scale = MIN_ZOOM;
      tx = 0;
      ty = 0;
    } else {
      const focal = computeFocalZoomPan({
        currentScale: scale,
        nextScale: clamped,
        currentTx: tx,
        currentTy: ty,
        focalX,
        focalY,
      });
      const bounded = clampPan(focal.tx, focal.ty, {
        scale: clamped,
        baseWidth: metrics.baseWidth,
        baseHeight: metrics.baseHeight,
        viewportWidth: metrics.viewportWidth,
        viewportHeight: metrics.viewportHeight,
      });
      scale = clamped;
      tx = bounded.tx;
      ty = bounded.ty;
    }

    if (expandBar && scale > 1.001) {
      isExpanded = true;
    }
    applyTransform({ animate });
    onActivity?.();
  }

  function stepZoom(delta) {
    const next = Math.round((scale + delta) * 100) / 100;
    setZoom(next, { animate: true, expandBar: true });
  }

  function reset({ animate = true, collapse = false } = {}) {
    isPinching = false;
    isDragging = false;
    dragPointerId = null;
    scale = MIN_ZOOM;
    tx = 0;
    ty = 0;
    if (collapse) {
      isExpanded = false;
    }
    applyTransform({ animate });
  }

  function isZoomed() {
    return scale > 1.001;
  }

  function isInteracting() {
    return isPinching || isDragging || Date.now() - lastPinchEndTime < 350;
  }

  /* ---- Desktop UI Control Wiring ---- */

  toggleBtn.addEventListener('click', () => {
    setExpanded(!isExpanded);
  });

  collapseBtn.addEventListener('click', () => {
    setExpanded(false);
  });

  outBtn.addEventListener('click', () => stepZoom(-ZOOM_STEP));
  inBtn.addEventListener('click', () => stepZoom(ZOOM_STEP));

  slider.addEventListener('input', () => {
    const val = Number(slider.value) / 100;
    setZoom(val, { animate: false });
  });

  percentBtn.addEventListener('click', () => {
    reset({ animate: true, collapse: false });
    onActivity?.();
  });

  /* ---- Desktop Mouse Drag-to-Pan & Double-Click Zoom ---- */

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0 || isOverlayOpen?.() || scale <= 1.001) return;
    e.preventDefault();
    isDragging = true;
    dragPointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragOriginTx = tx;
    dragOriginTy = ty;
    stage.setPointerCapture?.(e.pointerId);
    applyTransform({ animate: false });
  });

  stage.addEventListener('pointermove', (e) => {
    if (!isDragging || e.pointerId !== dragPointerId) return;
    const metrics = getMetrics();
    const bounded = clampPan(
      dragOriginTx + (e.clientX - dragStartX),
      dragOriginTy + (e.clientY - dragStartY),
      {
        scale,
        baseWidth: metrics.baseWidth,
        baseHeight: metrics.baseHeight,
        viewportWidth: metrics.viewportWidth,
        viewportHeight: metrics.viewportHeight,
      }
    );
    tx = bounded.tx;
    ty = bounded.ty;
    applyTransform({ animate: false });
  });

  const endDrag = (e) => {
    if (!isDragging || (dragPointerId !== null && e.pointerId !== dragPointerId)) return;
    isDragging = false;
    dragPointerId = null;
    applyTransform({ animate: false });
  };

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // Double-click artwork on desktop toggles smoothly between 100% and 200% at cursor
  stage.addEventListener('dblclick', (e) => {
    if (isOverlayOpen?.()) return;
    // Ignore touch-emulated double-clicks on phones
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;
    if (scale > 1.001) {
      reset({ animate: true, collapse: false });
    } else {
      const metrics = getMetrics();
      setZoom(2, {
        focalX: e.clientX - metrics.centerX,
        focalY: e.clientY - metrics.centerY,
        animate: true,
        expandBar: true,
      });
    }
  });

  // Trackpad pinch (ctrl+wheel on macOS/Windows browsers) zooms artwork instead of page
  stage.addEventListener(
    'wheel',
    (e) => {
      if (isOverlayOpen?.()) return;
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const metrics = getMetrics();
      const factor = Math.exp(-e.deltaY * 0.008);
      setZoom(scale * factor, {
        focalX: e.clientX - metrics.centerX,
        focalY: e.clientY - metrics.centerY,
        animate: false,
        expandBar: true,
      });
    },
    { passive: false }
  );

  /* ---- Mobile Two-Finger Pinch-to-Zoom with Snap-Back on Release ---- */

  stage.addEventListener(
    'touchstart',
    (e) => {
      if (isOverlayOpen?.()) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const metrics = getMetrics();
        isPinching = true;
        pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        pinchStartMidX = (t0.clientX + t1.clientX) / 2 - metrics.centerX;
        pinchStartMidY = (t0.clientY + t1.clientY) / 2 - metrics.centerY;
        applyTransform({ animate: false });
      }
    },
    { passive: false }
  );

  stage.addEventListener(
    'touchmove',
    (e) => {
      if (!isPinching) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const metrics = getMetrics();
        const currentDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const currentMidX = (t0.clientX + t1.clientX) / 2 - metrics.centerX;
        const currentMidY = (t0.clientY + t1.clientY) / 2 - metrics.centerY;

        const next = computePinchTransform({
          startDist: pinchStartDist,
          currentDist,
          startMidX: pinchStartMidX,
          startMidY: pinchStartMidY,
          currentMidX,
          currentMidY,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
        });

        scale = next.scale;
        tx = next.tx;
        ty = next.ty;
        applyTransform({ animate: false });
      }
    },
    { passive: false }
  );

  const finishPinch = (e) => {
    if (!isPinching) return;
    if (e.touches && e.touches.length >= 2) return;
    isPinching = false;
    lastPinchEndTime = Date.now();
    // Snap cleanly back to 100% on release
    scale = MIN_ZOOM;
    tx = 0;
    ty = 0;
    applyTransform({ animate: true });
    onActivity?.();
  };

  stage.addEventListener('touchend', finishPinch, { passive: true });
  stage.addEventListener('touchcancel', finishPinch, { passive: true });

  // Prevent iOS Safari proprietary gesturestart/gesturechange page-zoom on the artwork canvas
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((evtName) => {
    stage.addEventListener(
      evtName,
      (e) => {
        if (!isOverlayOpen?.()) {
          e.preventDefault();
        }
      },
      { passive: false }
    );
  });

  // Re-clamp pan cleanly when resizing the browser window
  window.addEventListener('resize', () => {
    if (scale <= 1.001) return;
    const metrics = getMetrics();
    const bounded = clampPan(tx, ty, {
      scale,
      baseWidth: metrics.baseWidth,
      baseHeight: metrics.baseHeight,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
    });
    tx = bounded.tx;
    ty = bounded.ty;
    applyTransform({ animate: false });
  });

  syncControlsUI();

  return {
    setZoom,
    stepZoom,
    reset,
    isZoomed,
    isInteracting,
    setExpanded,
  };
}
