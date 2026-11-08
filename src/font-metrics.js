// Web fonts can replace a fallback after a canvas-based editor has measured it.
// Observe them without delaying editor or Python startup.
export function observeFontMetrics(fonts, refresh) {
    if (!fonts) return () => {};
    let disposed = false;
    const update = () => { if (!disposed) refresh(); };
    fonts.addEventListener?.('loadingdone', update);
    fonts.addEventListener?.('loadingerror', update);
    Promise.resolve(fonts.ready).then(update, update);
    return () => {
        disposed = true;
        fonts.removeEventListener?.('loadingdone', update);
        fonts.removeEventListener?.('loadingerror', update);
    };
}
