package com.valkyrlabs.graymatter.localserver.association;

import com.valkyrlabs.graymatter.generated.api.MemoryAssociationRepository;
import com.valkyrlabs.graymatter.generated.model.MemoryAssociation;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityNotFoundException;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class MemoryAssociationService {
    private final PrincipalRecordRepository principals;
    private final MemoryEntryRepository memories;
    private final MemoryAssociationRepository associations;
    private final AssociationConstraints constraints;
    private final EntityManager entityManager;

    MemoryAssociationService(PrincipalRecordRepository principals, MemoryEntryRepository memories,
                             MemoryAssociationRepository associations, AssociationConstraints constraints, EntityManager entityManager) {
        this.principals = principals;
        this.memories = memories;
        this.associations = associations;
        this.constraints = constraints;
        this.entityManager = entityManager;
    }

    @Transactional
    public AssociationProtocol.Receipt record(String username, AssociationProtocol.Tuple tuple) {
        constraints.requireReady();
        PrincipalRecord owner = owner(username);
        String incarnations = lockEndpoints(owner, tuple);
        String scope = scope(owner);
        String hash = tuple.hash();
        String key = writeKey(owner, scope, hash, incarnations);
        List<MemoryAssociation> prior = associations.findMemoryAssociationByWriteKeyHash(key);
        if (!prior.isEmpty()) {
            if (prior.size() != 1) throw absent();
            return receipt(prior.get(0), owner, tuple, key, true);
        }
        MemoryAssociation row = new MemoryAssociation();
        row.setContractVersion(AssociationProtocol.VERSION);
        row.setFromId(tuple.fromId());
        row.setToId(tuple.toId());
        row.setRelation(tuple.relation());
        row.setTupleHash(hash);
        row.setScopeKeyHash(scope);
        row.setWriteKeyHash(key);
        row.setOwnerId(owner.getId());
        row.setRecordedAt(OffsetDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MICROS));
        return receipt(associations.saveAndFlush(row), owner, tuple, key, false);
    }

    @Transactional
    public AssociationProtocol.Receipt read(String username, UUID ref) {
        constraints.requireReady();
        PrincipalRecord owner = owner(username);
        MemoryAssociation row = associations.findById(ref).filter(r -> owner.getId().equals(r.getOwnerId()))
            .orElseThrow(MemoryAssociationService::absent);
        var tuple = new AssociationProtocol.Tuple(row.getFromId(), row.getToId(), row.getRelation());
        if (tuple.fromId() == null || tuple.toId() == null || tuple.fromId().equals(tuple.toId())
            || tuple.relation() == null || !AssociationProtocol.validRelation(tuple.relation())) throw absent();
        String incarnations = lockEndpoints(owner, tuple);
        // A delete followed by UUID reuse between the initial read and the locks must not revive an old receipt.
        try {
            entityManager.refresh(row);
        } catch (EntityNotFoundException removed) {
            throw absent();
        }
        return receipt(row, owner, tuple, writeKey(owner, scope(owner), tuple.hash(), incarnations), true);
    }

    private PrincipalRecord owner(String username) {
        return principals.findByUsernameIgnoreCase(username).filter(PrincipalRecord::isEnabled)
            .orElseThrow(MemoryAssociationService::absent);
    }

    private String lockEndpoints(PrincipalRecord owner, AssociationProtocol.Tuple tuple) {
        List<UUID> ids = List.of(tuple.fromId(), tuple.toId()).stream().sorted().toList();
        var incarnations = new java.util.ArrayList<String>();
        for (UUID id : ids) {
            MemoryEntry entry = memories.lockOwned(id, owner.getUsername()).orElseThrow(MemoryAssociationService::absent);
            entityManager.refresh(entry, LockModeType.PESSIMISTIC_WRITE);
            if (!owner.getId().equals(entry.getPrincipal().getId()) || entry.getCreatedAt() == null) throw absent();
            incarnations.add(AssociationProtocol.digest(id.toString(), owner.getId().toString(), entry.getCreatedAt().toString()));
        }
        return AssociationProtocol.digest(incarnations.get(0), incarnations.get(1));
    }

    static AssociationProtocol.Receipt receipt(MemoryAssociation row, PrincipalRecord owner,
                                                       AssociationProtocol.Tuple tuple, String key, boolean replayed) {
        String hash = tuple.hash();
        String scope = scope(owner);
        if (row.getId() == null || row.getRecordedAt() == null || Boolean.TRUE.equals(row.getTrashed())
            || !AssociationProtocol.VERSION.equals(row.getContractVersion()) || !owner.getId().equals(row.getOwnerId())
            || !tuple.fromId().equals(row.getFromId()) || !tuple.toId().equals(row.getToId())
            || !tuple.relation().equals(row.getRelation()) || !hash.equals(row.getTupleHash())
            || !scope.equals(row.getScopeKeyHash()) || !key.equals(row.getWriteKeyHash())) throw absent();
        return new AssociationProtocol.Receipt(AssociationProtocol.VERSION, "recorded", row.getId(), row.getFromId(),
            row.getToId(), row.getRelation(), hash, row.getRecordedAt(), replayed);
    }

    static String scope(PrincipalRecord owner) {
        return AssociationProtocol.digest("graymatter-lite/owner-scope/v1", owner.getId().toString());
    }

    static String writeKey(PrincipalRecord owner, String scope, String hash, String incarnations) {
        return AssociationProtocol.digest(AssociationProtocol.VERSION, owner.getId().toString(), scope, hash, incarnations);
    }

    private static ResponseStatusException absent() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Memory association not found");
    }
}
