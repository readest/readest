import { MultiDirectedGraph } from 'graphology';
import type { XRayEntity, XRayRelationship, XRayTimelineEvent } from './types';

export interface GraphNodeAttributes {
  label: string;
  type: string;
  entityType: string;
  x?: number;
  y?: number;
  size?: number;
  color?: string;
  entity: XRayEntity;
  community?: number;
  centrality?: number;
}

export interface GraphEdgeAttributes {
  label: string;
  type: string;
  relationshipType: string;
  weight?: number;
  color?: string;
  inferred?: boolean;
  confidence?: number;
  relationship: XRayRelationship;
}

export class XRayGraphBuilder {
  private graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>;

  constructor() {
    this.graph = new MultiDirectedGraph({
      multi: true,
      allowSelfLoops: false,
    });
  }

  buildFromSnapshot(
    entities: XRayEntity[],
    relationships: XRayRelationship[],
    events: XRayTimelineEvent[],
  ): void {
    this.graph.clear();

    entities.forEach((entity) => {
      if (!this.graph.hasNode(entity.id)) {
        this.graph.addNode(entity.id, {
          label: entity.canonicalName,
          type: 'circle',
          entityType: entity.type,
          size: 8,
          color: this.getEntityColor(entity.type),
          entity,
        });
      }
    });

    relationships.forEach((rel) => {
      if (!this.graph.hasNode(rel.sourceId) || !this.graph.hasNode(rel.targetId)) {
        return;
      }
      const edgeKey = `${rel.sourceId}->${rel.targetId}:${rel.type}`;
      if (!this.graph.hasEdge(edgeKey)) {
        this.graph.addEdgeWithKey(edgeKey, rel.sourceId, rel.targetId, {
          label: rel.type,
          type: 'line',
          relationshipType: rel.type,
          weight: rel.evidence.length,
          inferred: rel.inferred ?? false,
          confidence: rel.confidence ?? 1.0,
          color: rel.inferred ? '#94a3b8' : '#64748b',
          relationship: rel,
        });
      }
    });

    events.forEach((event) => {
      const eventNodeId = `event:${event.id}`;
      if (!this.graph.hasNode(eventNodeId)) {
        this.graph.addNode(eventNodeId, {
          label: event.summary.slice(0, 30) + (event.summary.length > 30 ? '...' : ''),
          type: 'circle',
          entityType: 'event',
          size: 5,
          color: '#f59e0b',
          entity: null as unknown as XRayEntity, // events don't have entity data
        });
      }

      event.involvedEntityIds.forEach((entityId) => {
        if (this.graph.hasNode(entityId)) {
          const edgeKey = `${entityId}->${eventNodeId}:involved_in`;
          if (!this.graph.hasEdge(edgeKey)) {
            this.graph.addEdgeWithKey(edgeKey, entityId, eventNodeId, {
              label: 'involved_in',
              type: 'line',
              relationshipType: 'involved_in',
              weight: 1,
              inferred: false,
              confidence: 1.0,
              color: '#d1d5db',
              relationship: null as unknown as XRayRelationship,
            });
          }
        }
      });
    });
  }

  getGraph(): MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes> {
    return this.graph;
  }

  exportGraph(): ReturnType<MultiDirectedGraph['export']> {
    return this.graph.export();
  }

  private getEntityColor(type: string): string {
    const colors: Record<string, string> = {
      character: '#3b82f6',
      location: '#10b981',
      organization: '#8b5cf6',
      artifact: '#f59e0b',
      term: '#06b6d4',
      event: '#ef4444',
      theme: '#ec4899',
      concept: '#6366f1',
    };
    return colors[type] || '#6b7280';
  }
}
