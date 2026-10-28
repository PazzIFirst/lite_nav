// 高于视口的侧栏跟随页面滚动，在下沿/上沿分别停靠；侧栏自身没有滚动容器。
export function followPageScroll(elements) {
  const states = elements.map(element => ({ element, top: null, lower: null, height: 0, visible: false }));
  let previousY = window.scrollY, frame = 0, hasScrolled = false, needsMeasure = true;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function update() {
    frame = 0;
    const y = window.scrollY, delta = y - previousY;
    previousY = y;
    if (delta) hasScrolled = true;
    const viewportHeight = window.innerHeight;
    // 先读全部尺寸，再写样式。滚动后的 rect.top 不参与 delta 运算，避免移动两次。
    const measured = states.map(state => {
      const element = state.element;
      if (!element.getClientRects().length) return { state, visible: false };
      const height = element.getBoundingClientRect().height;
      const gap = parseFloat(getComputedStyle(element).getPropertyValue('--sp-4')) || 16;
      const lower = Math.min(gap, viewportHeight - gap - height);
      const parent = element.parentElement;
      const parentStyle = getComputedStyle(parent);
      const naturalTop = parent.getBoundingClientRect().top + parent.clientTop + (parseFloat(parentStyle.paddingTop) || 0);
      const wasAtBottom = state.lower !== null && state.lower < gap && Math.abs(state.top - state.lower) < 1;
      let top;
      if (state.top === null || !state.visible || (!hasScrolled && needsMeasure)) {
        // 初始异步内容/历史滚动恢复以当前文档位置为基线，不假装从页面顶端开始滚。
        top = clamp(naturalTop, lower, gap);
      } else if (needsMeasure && wasAtBottom && delta >= 0) {
        top = lower;
      } else {
        top = clamp(state.top - delta, lower, gap);
      }
      return { state, visible: true, top, lower, height };
    });
    needsMeasure = false;
    for (const item of measured) {
      const { state } = item;
      if (!item.visible) {
        state.visible = false;
        state.element.style.removeProperty('top');
        continue;
      }
      state.visible = true;
      state.top = item.top;
      state.lower = item.lower;
      state.height = item.height;
      const value = `${item.top}px`;
      if (state.element.style.top !== value) state.element.style.top = value;
    }
  }
  function schedule(measure = false) {
    needsMeasure ||= measure;
    if (!frame) frame = requestAnimationFrame(update);
  }
  window.addEventListener('scroll', () => schedule(), { passive: true });
  window.addEventListener('resize', () => schedule(true));
  window.addEventListener('pageshow', () => {
    previousY = window.scrollY;
    // BFCache 保留了当前位置和滚动方向；只校准页面坐标，不把侧栏重新拉到另一端。
    schedule(true);
  });
  const observer = new ResizeObserver(() => schedule(true));
  for (const element of elements) observer.observe(element);
  for (const parent of new Set(elements.map(element => element.parentElement))) observer.observe(parent);
  schedule(true);
  return {
    reset() {
      previousY = window.scrollY;
      hasScrolled = true;
      for (const state of states) {
        state.top = parseFloat(getComputedStyle(state.element).getPropertyValue('--sp-4')) || 16;
        state.lower = null;
      }
      schedule(true);
    },
  };
}
