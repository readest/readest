/* eslint-disable react/no-danger */
'use client';

import React, { useEffect, useMemo, useRef, useCallback } from 'react';
import tinycolor from 'tinycolor2';
import {
  DataSet,
  Network,
  type Node as VisNode,
  type Edge as VisEdge,
} from 'vis-network/standalone';
import { useThemeStore } from '@/store/themeStore';
import type { XRayEntity, XRayRelationship } from '@/services/ai/types';

interface XRayGraphProps {
  entities: XRayEntity[];
  relationships: XRayRelationship[];
  onNodeClick?: (entity: XRayEntity) => void;
  selectedEntityId?: string | null;
}

const GRAPH_PHYSICS = {
  centerForce: 0.05,
  linkForce: 0.04,
  linkLength: 160,
  lineThickness: 2,
};

const XRayGraph: React.FC<XRayGraphProps> = ({
  entities,
  relationships,
  onNodeClick,
  selectedEntityId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesRef = useRef<DataSet<VisNode> | null>(null);
  const edgesRef = useRef<DataSet<VisEdge> | null>(null);
  const relationMapRef = useRef<
    Map<string, { sourceId: string; targetId: string; weight: number; inferred: boolean }>
  >(new Map());
  const hoveredNodeRef = useRef<string | null>(null);
  const hoveredNeighborsRef = useRef<Set<string>>(new Set());
  const hoverTimeoutRef = useRef<number | null>(null);
  const hoverPopupRef = useRef<HTMLDivElement | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const physics = GRAPH_PHYSICS;
  const themeCode = useThemeStore((state) => state.themeCode);

  const themeColors = useMemo(() => {
    const palette = themeCode.palette;
    return {
      label: palette['base-content'],
      labelActive: palette['base-content'],
      labelBackground: tinycolor(palette['base-100']).setAlpha(0.95).toRgbString(),
      edge: tinycolor(palette['base-content']).setAlpha(0.45).toRgbString(),
      edgeInferred: tinycolor(palette['base-content']).setAlpha(0.18).toRgbString(),
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

  const stopPhysicsTimeoutRef = useRef<number | null>(null);

  const applyPhysics = useCallback(
    (network: Network, enabled = true) => {
      network.setOptions({
        physics: {
          enabled,
          solver: 'forceAtlas2Based',
          stabilization: {
            enabled: true,
            iterations: 90,
            updateInterval: 10,
            fit: true,
          },
          adaptiveTimestep: true,
          minVelocity: 0.03,
          forceAtlas2Based: {
            centralGravity: 0.1 * physics.centerForce,
            springConstant: physics.linkForce,
            springLength: physics.linkLength,
            damping: 0.72,
            avoidOverlap: 0.5,
          },
        },
      });
    },
    [physics],
  );

  const schedulePhysicsStop = useCallback((network: Network, delay = 900) => {
    if (stopPhysicsTimeoutRef.current) {
      window.clearTimeout(stopPhysicsTimeoutRef.current);
    }
    stopPhysicsTimeoutRef.current = window.setTimeout(() => {
      network.setOptions({ physics: { enabled: false } });
      const stopSimulation = (network as unknown as { stopSimulation?: () => void }).stopSimulation;
      stopSimulation?.();
    }, delay);
  }, []);

  const applyEdges = useCallback(
    (network: Network) => {
      network.setOptions({
        edges: {
          width: physics.lineThickness,
        },
      });
    },
    [physics.lineThickness],
  );

  const clearHoverPopup = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (hoverPopupRef.current) {
      hoverPopupRef.current.remove();
      hoverPopupRef.current = null;
    }
  }, []);

  const updateNodeColors = useCallback(
    (nodes: XRayEntity[]) => {
      const dataset = nodesRef.current;
      if (!dataset) return;

      const updates = nodes.map((node) => {
        const active = hoveredNodeRef.current ?? selectedNodeRef.current ?? null;
        const isHovered = active === node.id;
        const isNeighbor = active ? hoveredNeighborsRef.current.has(node.id) : false;
        const dimmed = Boolean(active && !isHovered && !isNeighbor);

        const base = getEntityColor(node.type);
        const color = isHovered
          ? themeColors.nodeSelected
          : active && isNeighbor
            ? themeColors.nodeHighlight
            : base;
        const background = dimmed ? tinycolor(color).setAlpha(0.35).toRgbString() : color;
        const border = isHovered
          ? themeColors.labelActive
          : tinycolor(themeColors.label).setAlpha(0.5).toRgbString();

        return {
          id: node.id,
          color: {
            background,
            border,
          },
          font: {
            color: isHovered || isNeighbor ? themeColors.labelActive : themeColors.label,
            size: isHovered ? 14 : 12,
            face: 'ui-sans-serif',
            strokeWidth: isHovered || isNeighbor ? 3 : 1,
            strokeColor: themeColors.labelBackground,
          },
        } as VisNode;
      });

      dataset.update(updates);
      const edgeset = edgesRef.current;
      if (edgeset) {
        const edgeUpdates = Array.from(relationMapRef.current.entries()).map(([id, edge]) => {
          const active = hoveredNodeRef.current ?? selectedNodeRef.current ?? null;
          const isConnected = active && (edge.sourceId === active || edge.targetId === active);
          const edgeColor = edge.inferred ? themeColors.edgeInferred : themeColors.edge;
          return {
            id,
            color: {
              color: isConnected
                ? themeColors.edgeActive
                : active
                  ? tinycolor(edgeColor).setAlpha(0.2).toRgbString()
                  : edgeColor,
            },
            width: isConnected ? physics.lineThickness + 1 : physics.lineThickness,
          } as VisEdge;
        });
        edgeset.update(edgeUpdates);
      }
    },
    [
      getEntityColor,
      physics.lineThickness,
      themeColors.edge,
      themeColors.edgeActive,
      themeColors.edgeInferred,
      themeColors.label,
      themeColors.labelActive,
      themeColors.nodeHighlight,
      themeColors.nodeSelected,
    ],
  );

  const buildGraphData = useCallback(() => {
    const pairMap = new Map<
      string,
      { sourceId: string; targetId: string; weight: number; inferred: boolean }
    >();
    for (const rel of relationships) {
      if (rel.sourceId === rel.targetId) continue;
      const left = rel.sourceId < rel.targetId ? rel.sourceId : rel.targetId;
      const right = rel.sourceId < rel.targetId ? rel.targetId : rel.sourceId;
      const key = `${left}|${right}`;
      const existing = pairMap.get(key);
      const weight = rel.evidence.length || 1;
      if (!existing) {
        pairMap.set(key, {
          sourceId: left,
          targetId: right,
          weight,
          inferred: Boolean(rel.inferred),
        });
      } else {
        existing.weight += weight;
        existing.inferred = existing.inferred && Boolean(rel.inferred);
      }
    }

    const nodes = entities.map((entity) => ({
      id: entity.id,
      label: entity.canonicalName,
      color: getEntityColor(entity.type),
      font: {
        color: themeColors.label,
        size: 12,
        face: 'ui-sans-serif',
      },
      shape: 'dot',
      size: 10,
    })) satisfies VisNode[];

    const edges = Array.from(pairMap.entries()).map(([id, entry]) => ({
      id,
      from: entry.sourceId,
      to: entry.targetId,
      color: {
        color: entry.inferred ? themeColors.edgeInferred : themeColors.edge,
      },
      width: Math.max(1, Math.min(4, entry.weight * 0.5)),
      smooth: {
        enabled: true,
        type: 'continuous',
        roundness: 0.45,
      },
    })) satisfies VisEdge[];

    return { nodes, edges, relationMap: pairMap };
  }, [
    entities,
    relationships,
    getEntityColor,
    themeColors.edge,
    themeColors.edgeInferred,
    themeColors.label,
  ]);

  const initNetwork = useCallback(() => {
    if (!containerRef.current) return;
    const { nodes, edges, relationMap } = buildGraphData();
    if (nodes.length === 0 || edges.length === 0) return;

    const nodesData = new DataSet(nodes);
    const edgesData = new DataSet(edges);
    nodesRef.current = nodesData;
    edgesRef.current = edgesData;
    relationMapRef.current = relationMap;

    const network = new Network(
      containerRef.current,
      { nodes: nodesData, edges: edgesData },
      {
        layout: {
          improvedLayout: false,
        },
        physics: {
          enabled: true,
          solver: 'forceAtlas2Based',
          stabilization: {
            enabled: true,
            iterations: 90,
            updateInterval: 10,
            fit: true,
          },
          adaptiveTimestep: true,
          minVelocity: 0.03,
          forceAtlas2Based: {
            centralGravity: 0.1 * physics.centerForce,
            springConstant: physics.linkForce,
            springLength: physics.linkLength,
            damping: 0.72,
            avoidOverlap: 0.5,
          },
        },
        interaction: {
          hover: true,
          dragNodes: true,
          zoomView: true,
          dragView: true,
        },
        nodes: {
          borderWidth: 2,
          borderWidthSelected: 3,
          font: {
            color: themeColors.label,
            size: 12,
            face: 'ui-sans-serif',
          },
        },
        edges: {
          color: {
            color: themeColors.edge,
            highlight: themeColors.edgeActive,
          },
          width: physics.lineThickness,
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0.45,
          },
        },
      },
    );

    network.on('stabilizationIterationsDone', () => {
      network.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
      schedulePhysicsStop(network, 600);
    });

    network.on('dragStart', () => {
      applyPhysics(network, true);
      const startSimulation = (network as unknown as { startSimulation?: () => void })
        .startSimulation;
      startSimulation?.();
    });

    network.on('dragEnd', () => {
      schedulePhysicsStop(network, 1200);
    });

    network.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0] as string;
        const entity = entities.find((item) => item.id === nodeId);
        if (entity && onNodeClick) {
          onNodeClick(entity);
        }
        return;
      }
      if (params.edges.length > 0) {
        const edgeId = params.edges[0] as string;
        const relation = relationMapRef.current.get(edgeId);
        if (relation && onNodeClick) {
          const source = entities.find((item) => item.id === relation.sourceId);
          if (source) onNodeClick(source);
        }
      }
    });

    network.on('hoverNode', (params) => {
      const nodeId = params.node as string;
      hoveredNodeRef.current = nodeId;
      hoveredNeighborsRef.current = new Set([
        nodeId,
        ...network.getConnectedNodes(nodeId).map(String),
      ]);
      updateNodeColors(entities);

      clearHoverPopup();
      hoverTimeoutRef.current = window.setTimeout(() => {
        const node = entities.find((item) => item.id === nodeId);
        if (!node || !containerRef.current) return;
        const popup = document.createElement('div');
        popup.className = 'xray-graph-popup';
        const connections = relationships.filter(
          (rel) => rel.sourceId === nodeId || rel.targetId === nodeId,
        );
        const types = Array.from(new Set(connections.map((rel) => rel.type))).slice(0, 3);
        popup.innerHTML = `
          <div class="font-semibold">${node.canonicalName}</div>
          <div class="text-[11px] text-base-content/70">Connections: ${connections.length}</div>
          ${types.length > 0 ? `<div class="text-[11px] text-base-content/70">${types.join(', ')}</div>` : ''}
        `;
        popup.style.cssText = `
          position: absolute;
          background: ${themeColors.background};
          border: 1px solid ${tinycolor(themeColors.label).setAlpha(0.2).toRgbString()};
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 12px;
          color: ${themeColors.label};
          box-shadow: 0 8px 18px rgba(0, 0, 0, 0.2);
          z-index: 20;
          pointer-events: none;
        `;
        const position = network.getPositions([nodeId])[nodeId];
        if (position) {
          const dom = network.canvasToDOM(position);
          popup.style.left = `${dom.x + 12}px`;
          popup.style.top = `${dom.y + 12}px`;
        }
        containerRef.current.appendChild(popup);
        hoverPopupRef.current = popup;
      }, 500);
    });

    network.on('blurNode', () => {
      hoveredNodeRef.current = null;
      hoveredNeighborsRef.current = new Set();
      clearHoverPopup();
      updateNodeColors(entities);
    });

    networkRef.current = network;
    applyPhysics(network, true);
    applyEdges(network);
  }, [
    buildGraphData,
    physics,
    entities,
    relationships,
    themeColors.edge,
    themeColors.edgeActive,
    themeColors.label,
    themeColors.background,
    updateNodeColors,
    clearHoverPopup,
    applyPhysics,
    applyEdges,
    onNodeClick,
    schedulePhysicsStop,
  ]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (networkRef.current) {
      networkRef.current.destroy();
      networkRef.current = null;
    }
    containerRef.current.innerHTML = '';
    initNetwork();
    return () => {
      clearHoverPopup();
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [initNetwork, clearHoverPopup]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!networkRef.current) return;
      networkRef.current.redraw();
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    selectedNodeRef.current = selectedEntityId ?? null;
    if (networkRef.current) {
      updateNodeColors(entities);
    }
  }, [selectedEntityId, entities, updateNodeColors]);

  useEffect(() => {
    if (networkRef.current) {
      updateNodeColors(entities);
      applyPhysics(networkRef.current);
      applyEdges(networkRef.current);
    }
  }, [themeCode, entities, applyPhysics, applyEdges, updateNodeColors]);

  useEffect(() => {
    return () => {
      if (stopPhysicsTimeoutRef.current) {
        window.clearTimeout(stopPhysicsTimeoutRef.current);
      }
    };
  }, []);

  if (entities.length === 0 || relationships.length === 0) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-base-content/60 text-sm'>No relationships to display yet</p>
      </div>
    );
  }

  return (
    <div className='relative h-full w-full overflow-hidden'>
      <div
        ref={containerRef}
        className='absolute inset-0'
        style={{ background: themeColors.background }}
      />
    </div>
  );
};

export default XRayGraph;
