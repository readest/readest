import louvain from 'graphology-communities-louvain';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import type { MultiDirectedGraph } from 'graphology';
import type { XRayEntity, XRayRelationship, XRayEvidence } from './types';
import type { GraphNodeAttributes, GraphEdgeAttributes } from './graphBuilder';

export interface InferenceResult {
  inferredRelationships: XRayRelationship[];
  communities: Map<string, number>;
  centrality: Map<string, number>;
}

export class XRayGraphInference {
  inferRelationships(
    graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
    entities: XRayEntity[],
    bookHash: string,
    maxPage: number,
  ): InferenceResult {
    const inferredRelationships: XRayRelationship[] = [];

    graph.forEachNode((nodeA) => {
      const neighborsA = new Set(graph.neighbors(nodeA));
      neighborsA.forEach((nodeB) => {
        const neighborsB = new Set(graph.neighbors(nodeB));
        neighborsB.forEach((nodeC) => {
          if (nodeA === nodeC) return;
          if (neighborsA.has(nodeC)) return;

          const edgeExists = graph.hasEdge(nodeA, nodeC) || graph.hasEdge(nodeC, nodeA);
          if (edgeExists) return;

          const entityA = entities.find((e) => e.id === nodeA);
          const entityB = entities.find((e) => e.id === nodeB);
          const entityC = entities.find((e) => e.id === nodeC);

          if (!entityA || !entityB || !entityC) return;

          const now = Date.now();
          inferredRelationships.push({
            id: `xray_inferred_${nodeA}_${nodeC}_${now}`,
            sourceId: nodeA,
            targetId: nodeC,
            type: 'possibly_related',
            description: `Both connected to ${entityB.canonicalName}`,
            evidence: [this.createInferenceEvidence(entityA, entityB, entityC, maxPage)],
            confidence: 0.6,
            inferred: true,
            inferenceMethod: 'triadic',
            firstSeenPage: maxPage,
            lastSeenPage: maxPage,
            bookHash,
            maxPageIncluded: maxPage,
            lastUpdated: now,
            version: 1,
          });
        });
      });
    });

    const communities = this.detectCommunities(graph);
    const centrality = this.calculateCentrality(graph);

    return {
      inferredRelationships,
      communities,
      centrality,
    };
  }

  detectCommunities(
    graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  ): Map<string, number> {
    const communities = new Map<string, number>();

    try {
      const partition = louvain(graph, {
        resolution: 1.0,
        getEdgeWeight: (edge) => graph.getEdgeAttribute(edge, 'weight') || 1,
      });

      graph.forEachNode((node) => {
        communities.set(node, partition[node] ?? 0);
      });
    } catch {
      graph.forEachNode((node) => {
        communities.set(node, 0);
      });
    }

    return communities;
  }

  calculateCentrality(
    graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  ): Map<string, number> {
    const centrality = new Map<string, number>();

    try {
      const scores = betweennessCentrality(graph, {
        getEdgeWeight: (edge) => graph.getEdgeAttribute(edge, 'weight') || 1,
      });

      graph.forEachNode((node) => {
        centrality.set(node, scores[node] ?? 0);
      });
    } catch {
      graph.forEachNode((node) => {
        centrality.set(node, graph.degree(node));
      });
    }

    return centrality;
  }

  private createInferenceEvidence(
    source: XRayEntity,
    via: XRayEntity,
    target: XRayEntity,
    page: number,
  ): XRayEvidence {
    return {
      quote: `Inferred: ${source.canonicalName} and ${target.canonicalName} both connected to ${via.canonicalName}`,
      page,
      chunkId: 'inferred',
      confidence: 0.6,
      inferred: true,
    };
  }
}
