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
  async inferRelationships(
    graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
    entities: XRayEntity[],
    bookHash: string,
    maxPage: number,
    yieldIfNeeded?: () => Promise<void>,
  ): Promise<InferenceResult> {
    const inferredRelationships: XRayRelationship[] = [];
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const neighborSets = new Map<string, Set<string>>();

    graph.forEachNode((node) => {
      neighborSets.set(node, new Set(graph.neighbors(node)));
    });

    for (const [nodeA, neighborsA] of neighborSets) {
      for (const nodeB of neighborsA) {
        const neighborsB = neighborSets.get(nodeB);
        if (!neighborsB) continue;
        for (const nodeC of neighborsB) {
          if (nodeA === nodeC) continue;
          if (neighborsA.has(nodeC)) continue;

          const edgeExists = graph.hasEdge(nodeA, nodeC) || graph.hasEdge(nodeC, nodeA);
          if (edgeExists) continue;

          const entityA = entityById.get(nodeA);
          const entityB = entityById.get(nodeB);
          const entityC = entityById.get(nodeC);

          if (!entityA || !entityB || !entityC) continue;

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
        }
      }
      if (yieldIfNeeded) await yieldIfNeeded();
    }

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
