package com.valkyrlabs.graymatter.localserver.association;

import com.valkyrlabs.graymatter.generated.api.MemoryAssociationRepository;
import com.valkyrlabs.graymatter.generated.model.MemoryAssociation;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt;
import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt.AssociationRef;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.service.AssociationRecall;
import com.valkyrlabs.graymatter.localserver.service.MemoryHybridSearchService;
import com.valkyrlabs.graymatter.localserver.service.MemoryHybridSearchService.SearchHit;
import jakarta.persistence.EntityManager;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** One-hop selection over the real generated association rows; labels never enter retrieval text. */
@Service
class PersistedAssociationRecall implements AssociationRecall {
    private final PrincipalRecordRepository principals;
    private final MemoryEntryRepository memories;
    private final MemoryAssociationRepository associations;
    private final AssociationConstraints constraints;
    private final EntityManager entities;

    PersistedAssociationRecall(PrincipalRecordRepository principals, MemoryEntryRepository memories,
                               MemoryAssociationRepository associations, AssociationConstraints constraints,
                               EntityManager entities) {
        this.principals = principals;
        this.memories = memories;
        this.associations = associations;
        this.constraints = constraints;
        this.entities = entities;
    }

    @Override
    public Expansion discover(String username, List<SearchHit> anchors, List<SearchHit> eligibleNeighbors) {
        constraints.requireReady();
        PrincipalRecord owner = owner(username);
        List<UUID> ids = anchors.stream().limit(MAX_ANCHORS).map(hit -> hit.entry().getId()).distinct().sorted().toList();
        List<MemoryAssociation> edges = edges(owner, ids);
        boolean truncated = edges.size() > MAX_EDGES;
        Map<UUID, SearchHit> seeds = new HashMap<>();
        anchors.stream().limit(MAX_ANCHORS).forEach(hit -> seeds.put(hit.entry().getId(), hit));
        List<SearchHit> selected = new ArrayList<>();
        List<AssociationRef> refs = new ArrayList<>();
        Set<UUID> seen = new HashSet<>(ids);
        for (SearchHit neighbor : eligibleNeighbors) {
            if (seen.contains(neighbor.entry().getId())) continue;
            for (MemoryAssociation edge : edges.subList(0, Math.min(edges.size(), MAX_EDGES))) {
                SearchHit anchor = seeds.get(edge.getFromId());
                if (anchor == null || !neighbor.entry().getId().equals(edge.getToId())) continue;
                String proof = edgeProof(edge, owner, anchor.entry(), neighbor.entry());
                if (proof == null) continue;
                if (selected.size() == MAX_NEIGHBORS) {
                    truncated = true;
                } else {
                    selected.add(neighbor);
                    refs.add(new AssociationRef(edge.getId(), anchor.entry().getId(), neighbor.entry().getId(),
                        proof, anchor.sourceHash(), neighbor.sourceHash()));
                }
                seen.add(neighbor.entry().getId());
                break;
            }
        }
        return new Expansion(List.copyOf(selected), List.copyOf(refs), ids, stateHash(edges), truncated);
    }

    @Override
    public boolean current(String username, MemoryRetrievalReceipt receipt) {
        constraints.requireReady();
        PrincipalRecord owner = owner(username);
        if (!owner.getId().equals(receipt.getPrincipal().getId()) || receipt.getAssociationAnchors() == null
            || receipt.getAssociationStateHash() == null || !receipt.getAssociationStateHash().matches("[0-9a-f]{64}")
            || receipt.getAssociationRefs().size() > MAX_NEIGHBORS) return false;
        List<UUID> anchors;
        try {
            anchors = receipt.getAssociationAnchors().isEmpty() ? List.of()
                : java.util.Arrays.stream(receipt.getAssociationAnchors().split(",", -1)).map(AssociationProtocol::uuid).toList();
        } catch (IllegalArgumentException | ResponseStatusException malformed) {
            return false;
        }
        if (anchors.size() > MAX_ANCHORS || new HashSet<>(anchors).size() != anchors.size()
            || !stateHash(edges(owner, anchors)).equals(receipt.getAssociationStateHash())) return false;
        Map<UUID, String> pointers = new HashMap<>();
        receipt.getSources().forEach(ref -> pointers.put(ref.getMemoryId(), ref.getSourceHash()));
        if (!pointers.keySet().containsAll(anchors)) return false;
        for (AssociationRef ref : receipt.getAssociationRefs()) {
            if (ref.getAssociationRef() == null || ref.getAnchorId() == null || ref.getMemoryId() == null
                || ref.getAssociationHash() == null || !ref.getAssociationHash().matches("[0-9a-f]{64}")
                || ref.getAnchorSourceHash() == null || !ref.getAnchorSourceHash().matches("[0-9a-f]{64}")
                || ref.getSourceHash() == null || !ref.getSourceHash().matches("[0-9a-f]{64}")) return false;
        }
        Set<UUID> required = new HashSet<>(anchors);
        receipt.getAssociationRefs().forEach(ref -> { required.add(ref.getAnchorId()); required.add(ref.getMemoryId()); });
        Map<UUID, MemoryEntry> sources = new HashMap<>();
        if (!required.isEmpty()) memories.findByPrincipalUsernameIgnoreCaseAndIdIn(username, List.copyOf(required))
            .forEach(entry -> sources.put(entry.getId(), entry));
        if (!sources.keySet().containsAll(required)) return false;
        for (UUID id : anchors) if (!Objects.equals(pointers.get(id), MemoryHybridSearchService.sourceHash(sources.get(id)))) return false;
        for (AssociationRef ref : receipt.getAssociationRefs()) {
            if (!anchors.contains(ref.getAnchorId()) || !Objects.equals(pointers.get(ref.getAnchorId()), ref.getAnchorSourceHash())
                || !Objects.equals(pointers.get(ref.getMemoryId()), ref.getSourceHash())) return false;
            MemoryEntry anchor = sources.get(ref.getAnchorId()), neighbor = sources.get(ref.getMemoryId());
            MemoryAssociation edge = ref.getAssociationRef() == null ? null : associations.findById(ref.getAssociationRef()).orElse(null);
            if (!Objects.equals(ref.getAnchorSourceHash(), MemoryHybridSearchService.sourceHash(anchor))
                || !Objects.equals(ref.getSourceHash(), MemoryHybridSearchService.sourceHash(neighbor))) return false;
            String proof = edgeProof(edge, owner, anchor, neighbor);
            if (proof == null || !proof.equals(ref.getAssociationHash())) return false;
        }
        return true;
    }

    private List<MemoryAssociation> edges(PrincipalRecord owner, List<UUID> anchors) {
        if (anchors.isEmpty()) return List.of();
        // The bound is in the database, and includes one sentinel to attest a cut rather than
        // silently claiming complete traversal. Apply current endpoint ownership before this count;
        // revoked endpoints must not become a hidden-presence signal through the truncation flag.
        // No reverse or discovered-neighbor seed expansion.
        return entities.createQuery("select a from " + MemoryAssociation.class.getName()
            + " a where a.ownerId = :owner and a.scopeKeyHash = :scope and a.fromId in :anchors"
            + " and (a.trashed is null or a.trashed = false)"
            + " and exists (select m.id from MemoryEntry m where m.id = a.toId and m.principal.id = :owner)"
            + " order by a.id",
            MemoryAssociation.class).setParameter("owner", owner.getId())
            .setParameter("scope", MemoryAssociationService.scope(owner)).setParameter("anchors", anchors)
            .setMaxResults(MAX_EDGES + 1).getResultList();
    }

    private static String stateHash(List<MemoryAssociation> edges) {
        List<String> fields = new ArrayList<>();
        fields.add(POLICY);
        for (MemoryAssociation edge : edges) {
            fields.add(Objects.toString(edge.getId(), ""));
            fields.add(Objects.toString(edge.getFromId(), ""));
            fields.add(Objects.toString(edge.getToId(), ""));
            fields.add(Objects.toString(edge.getOwnerId(), ""));
            fields.add(Objects.toString(edge.getScopeKeyHash(), ""));
            fields.add(Objects.toString(edge.getWriteKeyHash(), ""));
            fields.add(Objects.toString(edge.getTupleHash(), ""));
            fields.add(Objects.toString(edge.getRelation(), ""));
            fields.add(Objects.toString(edge.getContractVersion(), ""));
            fields.add(Objects.toString(edge.getRecordedAt(), ""));
            fields.add(Objects.toString(edge.getTrashed(), ""));
        }
        return AssociationProtocol.digest(fields.toArray(String[]::new));
    }

    private static String edgeProof(MemoryAssociation edge, PrincipalRecord owner, MemoryEntry anchor, MemoryEntry neighbor) {
        if (edge == null || anchor == null || neighbor == null || anchor.getId().equals(neighbor.getId())
            || anchor.getCreatedAt() == null || neighbor.getCreatedAt() == null
            || !owner.getId().equals(anchor.getPrincipal().getId()) || !owner.getId().equals(neighbor.getPrincipal().getId())
            || edge.getRelation() == null || !AssociationProtocol.validRelation(edge.getRelation())) return null;
        var tuple = new AssociationProtocol.Tuple(anchor.getId(), neighbor.getId(), edge.getRelation());
        List<String> incarnations = List.of(anchor, neighbor).stream().sorted(java.util.Comparator.comparing(MemoryEntry::getId))
            .map(entry -> AssociationProtocol.digest(entry.getId().toString(), owner.getId().toString(), entry.getCreatedAt().toString())).toList();
        String key = MemoryAssociationService.writeKey(owner, MemoryAssociationService.scope(owner), tuple.hash(),
            AssociationProtocol.digest(incarnations.get(0), incarnations.get(1)));
        try {
            MemoryAssociationService.receipt(edge, owner, tuple, key, true);
        } catch (ResponseStatusException denied) {
            return null;
        }
        return AssociationProtocol.digest(POLICY, edge.getId().toString(), key, edge.getTupleHash(), edge.getRecordedAt().toInstant().toString());
    }

    private PrincipalRecord owner(String username) {
        return principals.findByUsernameIgnoreCase(username).filter(PrincipalRecord::isEnabled)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Memory association unavailable"));
    }
}
