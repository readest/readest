import { useEffect } from 'react';
import { FoliateView } from '@/types/view';

type FoliateEventHandler = {
  onLoad?: (event: Event) => void;
  onStabilized?: (event: Event) => void;
  onRelocate?: (event: Event) => void;
  onLinkClick?: (event: Event) => void;
  onRendererRelocate?: (event: Event) => void;
  onCreateOverlay?: (event: Event) => void;
  onDrawAnnotation?: (event: Event) => void;
  onShowAnnotation?: (event: Event) => void;
};

export const useFoliateEvents = (view: FoliateView | null, handlers?: FoliateEventHandler) => {
  const onLoad = handlers?.onLoad;
  const onStabilized = handlers?.onStabilized;
  const onRelocate = handlers?.onRelocate;
  const onLinkClick = handlers?.onLinkClick;
  const onRendererRelocate = handlers?.onRendererRelocate;
  const onCreateOverlay = handlers?.onCreateOverlay;
  const onDrawAnnotation = handlers?.onDrawAnnotation;
  const onShowAnnotation = handlers?.onShowAnnotation;

  useEffect(() => {
    if (!view) return;
    if (onLoad) view.addEventListener('load', onLoad);
    if (onStabilized) view.renderer.addEventListener('stabilized', onStabilized);
    if (onRelocate) view.addEventListener('relocate', onRelocate);
    if (onLinkClick) view.addEventListener('link', onLinkClick);
    if (onRendererRelocate) view.renderer.addEventListener('relocate', onRendererRelocate);
    if (onCreateOverlay) view.addEventListener('create-overlay', onCreateOverlay);
    if (onDrawAnnotation) view.addEventListener('draw-annotation', onDrawAnnotation);
    if (onShowAnnotation) view.addEventListener('show-annotation', onShowAnnotation);

    return () => {
      if (onLoad) view.removeEventListener('load', onLoad);
      if (onStabilized) view.renderer.removeEventListener('stabilized', onStabilized);
      if (onRelocate) view.removeEventListener('relocate', onRelocate);
      if (onLinkClick) view.removeEventListener('link', onLinkClick);
      if (onRendererRelocate) view.renderer.removeEventListener('relocate', onRendererRelocate);
      if (onCreateOverlay) view.removeEventListener('create-overlay', onCreateOverlay);
      if (onDrawAnnotation) view.removeEventListener('draw-annotation', onDrawAnnotation);
      if (onShowAnnotation) view.removeEventListener('show-annotation', onShowAnnotation);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
};
