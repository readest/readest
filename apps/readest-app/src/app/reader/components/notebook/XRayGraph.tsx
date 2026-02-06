'use client';

import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import tinycolor from 'tinycolor2';
import { XRayGraphBuilder } from '@/services/ai/xray/graphBuilder';
import { useThemeStore } from '@/store/themeStore';
import type { XRayEntity, XRayRelationship, XRayTimelineEvent } from '@/services/ai/types';

interface SigmaInstance {
  on: (event: string, callback: (data: { node?: string; edge?: string }) => void) => void;
  kill: () => void;
  refresh: () => void;
  resize?: () => void;
  getGraph: () => GraphInstance;
}

interface GraphInstance {
  hasNode: (node: string) => boolean;
  hasEdge: (edge: string) => boolean;
  source: (edge: string) => string;
  target: (edge: string) => string;
  neighbors: (node: string) => string[];
  edges: (node: string) => string[];
  getNodeAttributes: (node: string) => NodeData;
  getEdgeAttributes: (edge: string) => EdgeData;
}

interface NodeData {
  label: string;
  color?: string;
  size?: number;
  entityType?: string;
  entity: XRayEntity;
}

interface EdgeData {
  label: string;
  color?: string;
  inferred?: boolean;
  relationship: XRayRelationship;
}

interface XRayGraphProps {
  entities: XRayEntity[];
  relationships: XRayRelationship[];
  events: XRayTimelineEvent[];
  onNodeClick?: (entity: XRayEntity) => void;
  onEdgeClick?: (relationship: XRayRelationship) => void;
  selectedEntityId?: string | null;
}

const XRayGraph: React.FC<XRayGraphProps> = ({
  entities,
  relationships,
  events,
  onNodeClick,
  onEdgeClick,
  selectedEntityId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<SigmaInstance | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const renderIdRef = useRef(0);
  const themeCode = useThemeStore((state) => state.themeCode);

  const themeColors = useMemo(() => {
    const palette = themeCode.palette;
    return {
      label: palette['base-content'],
      labelActive: palette['base-content'],
      labelBackground: tinycolor(palette['base-100']).setAlpha(0.9).toRgbString(),
      edge: tinycolor(palette['base-content']).setAlpha(0.35).toRgbString(),
      edgeInferred: tinycolor(palette['base-content']).setAlpha(0.2).toRgbString(),
      edgeActive: palette.primary,
      background: palette['base-100'],
      nodeDefault: palette.neutral,
      nodeSelected: palette.primary,
      nodeHighlight: palette.accent,
    };
  }, [themeCode]);

  const entityColors = useMemo(() => {
    const palette = themeCode.palette;
    return {
      character: palette.primary,
      location: palette.secondary,
      organization: palette.accent,
      artifact: tinycolor(palette.primary).darken(12).toHexString(),
      term: tinycolor(palette.secondary).darken(12).toHexString(),
      concept: tinycolor(palette.accent).darken(12).toHexString(),
      event: tinycolor(palette.neutral).toHexString(),
      default: palette.neutral,
    };
  }, [themeCode]);

  const getEntityColor = useCallback(
    (type?: string) => {
      const key = (type || 'default') as keyof typeof entityColors;
      return entityColors[key] || entityColors.default;
    },
    [entityColors],
  );

  const refreshGraph = useCallback(() => {
    if (sigmaRef.current) {
      sigmaRef.current.refresh();
    }
  }, []);

  const initGraph = useCallback(async () => {
    if (!containerRef.current || entities.length === 0) return;
    const renderId = (renderIdRef.current += 1);

    try {
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }

      containerRef.current.innerHTML = '';

      const builder = new XRayGraphBuilder();
      builder.buildFromSnapshot(entities, relationships, events);
      const graph = builder.getGraph();

      const { circular } = await import('graphology-layout');
      circular.assign(graph, { scale: 240 });
      const forceAtlas2 = await import('graphology-layout-forceatlas2').then((mod) =>
        'default' in mod ? mod.default : mod,
      );
      forceAtlas2.assign(graph, {
        iterations: 120,
        settings: {
          gravity: 0.8,
          scalingRatio: 28,
          slowDown: 1.5,
          edgeWeightInfluence: 0.6,
          linLogMode: true,
          outboundAttractionDistribution: true,
          adjustSizes: true,
          barnesHutOptimize: true,
          barnesHutTheta: 0.8,
        },
      });
      const SigmaClass = await import('sigma').then((mod) => mod.default);
      const sigma = new SigmaClass(graph, containerRef.current, {
        renderLabels: true,
        labelSize: 10,
        labelWeight: '500',
        labelColor: { color: themeColors.label },
        defaultNodeColor: themeColors.nodeDefault,
        defaultEdgeColor: themeColors.edge,
        zIndex: true,
        nodeReducer: (_node: string, data: NodeData) => {
          const activeNode = hoveredNodeRef.current ?? selectedNodeRef.current ?? null;
          const isHighlighted = activeNode === _node;
          const isConnected = activeNode ? graph.neighbors(activeNode).includes(_node) : false;
          const isDimmed = Boolean(activeNode && !isHighlighted && !isConnected);
          const baseColor = getEntityColor(data.entityType) || themeColors.nodeDefault;
          const color = isHighlighted
            ? themeColors.nodeSelected
            : activeNode && isConnected
              ? themeColors.nodeHighlight
              : baseColor;

          return {
            ...data,
            label: data.label,
            color,
            size: isHighlighted ? 11 : isConnected ? 8 : 6,
            zIndex: isHighlighted ? 2 : isConnected ? 1 : 0,
            opacity: isDimmed ? 0.2 : 1,
            labelColor: {
              color: isHighlighted || isConnected ? themeColors.labelActive : themeColors.label,
            },
            labelBackgroundColor: isHighlighted ? themeColors.labelBackground : undefined,
            labelSize: isHighlighted ? 12 : 10,
            labelWeight: isHighlighted ? '600' : '500',
          };
        },
        edgeReducer: (_edge: string, data: EdgeData) => {
          const source = graph.source(_edge);
          const target = graph.target(_edge);
          const activeNode = hoveredNodeRef.current ?? selectedNodeRef.current ?? null;
          const isConnected = activeNode && (source === activeNode || target === activeNode);
          const isDimmed = Boolean(activeNode && !isConnected);
          const edgeColor = data.inferred ? themeColors.edgeInferred : themeColors.edge;

          return {
            ...data,
            color: isConnected ? themeColors.edgeActive : edgeColor,
            size: isConnected ? 2.5 : data.inferred ? 1 : 1.5,
            zIndex: isConnected ? 1 : 0,
            opacity: isDimmed ? 0.15 : data.inferred ? 0.5 : 0.8,
          };
        },
      });

      sigma.on('clickNode', ({ node }: { node: string }) => {
        const data = graph.getNodeAttributes(node) as NodeData;
        if (data.entity && onNodeClick) {
          onNodeClick(data.entity);
        }
      });

      sigma.on('clickEdge', ({ edge }: { edge: string }) => {
        const data = graph.getEdgeAttributes(edge) as EdgeData;
        if (data.relationship && onEdgeClick) {
          onEdgeClick(data.relationship);
        }
      });

      sigma.on('enterNode', ({ node }: { node: string }) => {
        hoveredNodeRef.current = node;
        refreshGraph();
      });

      sigma.on('leaveNode', () => {
        hoveredNodeRef.current = null;
        refreshGraph();
      });

      if (renderId !== renderIdRef.current) {
        sigma.kill();
        return;
      }

      sigmaRef.current = sigma as unknown as SigmaInstance;
    } catch (error) {
      console.error('failed to initialize graph:', error);
    }
  }, [
    entities,
    relationships,
    events,
    onNodeClick,
    onEdgeClick,
    themeColors,
    getEntityColor,
    refreshGraph,
  ]);

  useEffect(() => {
    initGraph();
    const container = containerRef.current;

    return () => {
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [initGraph]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!sigmaRef.current) return;
      sigmaRef.current.resize?.();
      sigmaRef.current.refresh();
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    selectedNodeRef.current = selectedEntityId ?? null;
    refreshGraph();
  }, [selectedEntityId, refreshGraph]);

  useEffect(() => {
    refreshGraph();
  }, [themeCode, refreshGraph]);

  if (entities.length === 0) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-base-content/60 text-sm'>No entities to display</p>
      </div>
    );
  }

  return (
    <div
      className='sigma-container relative h-full w-full overflow-hidden'
      ref={containerRef}
      style={{ background: themeColors.background }}
    >
      <style jsx global>{`
        .sigma-container {
          width: 100% !important;
          height: 100% !important;
        }
        .sigma-container canvas {
          display: block !important;
        }
      `}</style>
    </div>
  );
};

export default XRayGraph;
