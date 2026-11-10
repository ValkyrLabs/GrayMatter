package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt;
import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt.AssociationRef;
import java.util.List;
import java.util.UUID;

/** Optional bridge to the actual generated association store; a bare Lite build has no provider. */
public interface AssociationRecall {
    String POLICY = "bifrost-lite-association/v1";
    int MAX_ANCHORS = 8;
    int MAX_EDGES = 64;
    int MAX_NEIGHBORS = 8;

    Expansion discover(String username, List<MemoryHybridSearchService.SearchHit> anchors,
                       List<MemoryHybridSearchService.SearchHit> eligibleNeighbors);

    boolean current(String username, MemoryRetrievalReceipt receipt);

    record Expansion(List<MemoryHybridSearchService.SearchHit> neighbors, List<AssociationRef> refs,
                     List<UUID> anchors, String stateHash, boolean truncated) {}
}
