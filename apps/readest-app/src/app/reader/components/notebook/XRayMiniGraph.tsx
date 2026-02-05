'use client';

import React, { useMemo } from 'react';

import { formatRelationshipLabel } from '@/services/ai/xrayService';
import type { XRayEntity, XRayRelationship } from '@/services/ai/types';

interface XRayMiniGraphProps {
  center: XRayEntity;
  relationships: XRayRelationship[];
  entityById: Map<string, XRayEntity>;
  maxNodes?: number;
}

const truncateLabel = (value: string, limit = 18): string => {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}...`;
};

const XRayMiniGraph: React.FC<XRayMiniGraphProps> = ({
  center,
  relationships,
  entityById,
  maxNodes = 8,
}) => {
  const connections = useMemo(() => {
    return relationships
      .filter((rel) => rel.sourceId === center.id || rel.targetId === center.id)
      .map((rel) => {
        const isSource = rel.sourceId === center.id;
        const otherId = isSource ? rel.targetId : rel.sourceId;
        const other = entityById.get(otherId);
        if (!other) return null;
        return {
          id: rel.id,
          name: other.canonicalName,
          relation: formatRelationshipLabel(rel.type),
        };
      })
      .filter(Boolean)
      .slice(0, maxNodes) as Array<{ id: string; name: string; relation: string }>;
  }, [center.id, relationships, entityById, maxNodes]);

  if (connections.length === 0) {
    return <p className='text-base-content/50 text-xs'>No connections yet</p>;
  }

  const size = 240;
  const centerPoint = size / 2;
  const radius = size / 2 - 34;
  const step = (Math.PI * 2) / connections.length;

  return (
    <div className='border-base-300/60 bg-base-100/40 animate-in fade-in rounded-md border p-2 duration-300'>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className='h-44 w-full transition-opacity duration-300'
        role='img'
        aria-label='Relationship connections'
      >
        <g className='text-base-content/40' stroke='currentColor' strokeWidth={1.2}>
          {connections.map((connection, index) => {
            const angle = step * index - Math.PI / 2;
            const x = centerPoint + radius * Math.cos(angle);
            const y = centerPoint + radius * Math.sin(angle);
            return (
              <line key={`edge-${connection.id}`} x1={centerPoint} y1={centerPoint} x2={x} y2={y} />
            );
          })}
        </g>

        <g className='text-base-content/60' fill='currentColor'>
          {connections.map((connection, index) => {
            const angle = step * index - Math.PI / 2;
            const x = centerPoint + radius * Math.cos(angle);
            const y = centerPoint + radius * Math.sin(angle);
            const labelX = centerPoint + radius * 0.56 * Math.cos(angle);
            const labelY = centerPoint + radius * 0.56 * Math.sin(angle);
            return (
              <g key={`node-${connection.id}`}>
                <circle r={6} cx={x} cy={y} className='text-base-content/60' />
                <text
                  x={x}
                  y={y + 14}
                  textAnchor='middle'
                  className='text-base-content/70 text-[10px]'
                  fill='currentColor'
                >
                  {truncateLabel(connection.name, 14)}
                </text>
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor='middle'
                  className='text-base-content/50 text-[9px]'
                  fill='currentColor'
                >
                  {truncateLabel(connection.relation, 16)}
                </text>
              </g>
            );
          })}
        </g>

        <g className='text-base-content' fill='currentColor'>
          <circle r={10} cx={centerPoint} cy={centerPoint} className='text-base-content' />
          <text
            x={centerPoint}
            y={centerPoint + 24}
            textAnchor='middle'
            className='text-base-content text-[11px]'
            fill='currentColor'
          >
            {truncateLabel(center.canonicalName, 18)}
          </text>
        </g>
      </svg>
    </div>
  );
};

export default XRayMiniGraph;
