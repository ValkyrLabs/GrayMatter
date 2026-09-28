package com.valkyrlabs.graymatter.localserver.model;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Content-free lineage for locally compiled memory context. */
@Entity
@Table(name = "memory_retrieval_receipt")
public class MemoryRetrievalReceipt {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "principal_id", nullable = false)
    private PrincipalRecord principal;

    @Column(nullable = false, length = 64)
    private String queryHash;

    @Column(nullable = false, length = 40)
    private String policyVersion = "bifrost-lite-context/v1";

    @Column(nullable = false, length = 20)
    private String retrievalMode;

    @Column(nullable = false)
    private int tokenBudget;

    @Column
    private UUID parentReceiptId;

    @Column(nullable = false)
    private Instant createdAt;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "memory_retrieval_receipt_item", joinColumns = @JoinColumn(name = "receipt_id"))
    @OrderColumn(name = "item_rank")
    private List<SourceRef> sources = new ArrayList<>();

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "memory_retrieval_receipt_protected", joinColumns = @JoinColumn(name = "receipt_id"))
    @Column(name = "memory_id", nullable = false)
    private Set<UUID> protectedRefs = new HashSet<>();

    protected MemoryRetrievalReceipt() {}

    public MemoryRetrievalReceipt(PrincipalRecord principal, String queryHash, String retrievalMode,
                                  int tokenBudget, UUID parentReceiptId, List<SourceRef> sources,
                                  Set<UUID> protectedRefs) {
        this.principal = principal;
        this.queryHash = queryHash;
        this.retrievalMode = retrievalMode;
        this.tokenBudget = tokenBudget;
        this.parentReceiptId = parentReceiptId;
        this.sources = new ArrayList<>(sources);
        this.protectedRefs = new HashSet<>(protectedRefs);
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public PrincipalRecord getPrincipal() { return principal; }
    public String getQueryHash() { return queryHash; }
    public String getPolicyVersion() { return policyVersion; }
    public String getRetrievalMode() { return retrievalMode; }
    public int getTokenBudget() { return tokenBudget; }
    public UUID getParentReceiptId() { return parentReceiptId; }
    public Instant getCreatedAt() { return createdAt; }
    public List<SourceRef> getSources() { return sources; }
    public Set<UUID> getProtectedRefs() { return protectedRefs; }

    @Embeddable
    public static class SourceRef {
        @Column(name = "memory_id", nullable = false)
        private UUID memoryId;

        @Column(name = "source_hash", nullable = false, length = 64)
        private String sourceHash;

        protected SourceRef() {}

        public SourceRef(UUID memoryId, String sourceHash) {
            this.memoryId = memoryId;
            this.sourceHash = sourceHash;
        }

        public UUID getMemoryId() { return memoryId; }
        public String getSourceHash() { return sourceHash; }
    }
}
