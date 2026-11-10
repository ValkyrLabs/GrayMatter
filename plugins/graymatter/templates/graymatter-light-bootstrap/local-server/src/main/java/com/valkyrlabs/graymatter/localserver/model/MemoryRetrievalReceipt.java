package com.valkyrlabs.graymatter.localserver.model;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Embeddable;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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

    // Present only for a discovery pass. A fixed-source fork cannot attest a new search.
    @Column(name = "discovery_scope_hash", length = 64)
    private String discoveryScopeHash;

    // SHA-256 selectors (type, source and up to 50 tags) and the pre-ranking candidate snapshot.
    @Column(name = "candidate_selectors", length = 3400)
    private String candidateSelectors;

    @Column(name = "candidate_state_hash", length = 64)
    private String candidateStateHash;

    @Column(name = "association_anchors", length = 300)
    private String associationAnchors;

    @Column(name = "association_state_hash", length = 64)
    private String associationStateHash;

    @Column(name = "association_truncated")
    private Boolean associationTruncated;

    @Column(nullable = false, length = 40)
    private String policyVersion;

    // H2 v2 stores this field as a native enum whose allowed values are fixed at table creation.
    @Enumerated(EnumType.STRING)
    @Column(name = "recorded_retrieval_status", length = 32, insertable = false, updatable = false)
    private RetrievalStatus legacyRetrievalStatus;

    @Column(name = "policy_decision", length = 32)
    private String policyDecision;

    @Column
    private Boolean semanticDegraded;

    @Column
    private Boolean sourceSetNarrowed;

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

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "memory_retrieval_receipt_association", joinColumns = @JoinColumn(name = "receipt_id"))
    @OrderColumn(name = "association_rank")
    private List<AssociationRef> associationRefs = new ArrayList<>();

    protected MemoryRetrievalReceipt() {}

    public MemoryRetrievalReceipt(PrincipalRecord principal, String queryHash, String retrievalMode,
                                  int tokenBudget, String policyVersion, RetrievalStatus recordedRetrievalStatus,
                                  boolean semanticDegraded, boolean sourceSetNarrowed,
                                  UUID parentReceiptId, List<SourceRef> sources,
                                  Set<UUID> protectedRefs) {
        this.principal = principal;
        this.queryHash = queryHash;
        this.retrievalMode = retrievalMode;
        this.tokenBudget = tokenBudget;
        this.policyVersion = policyVersion;
        this.policyDecision = recordedRetrievalStatus.name();
        this.semanticDegraded = semanticDegraded;
        this.sourceSetNarrowed = sourceSetNarrowed;
        this.parentReceiptId = parentReceiptId;
        this.sources = new ArrayList<>(sources);
        this.protectedRefs = new HashSet<>(protectedRefs);
        this.createdAt = Instant.now();
    }

    public void bindCandidateState(String selectors, String hash) {
        this.candidateSelectors = selectors;
        this.candidateStateHash = hash;
    }
    public String getCandidateSelectors() { return candidateSelectors; }
    public String getCandidateStateHash() { return candidateStateHash; }

    public void bindAssociations(List<UUID> anchors, String stateHash, boolean truncated, List<AssociationRef> refs) {
        this.associationAnchors = anchors.stream().map(UUID::toString).collect(java.util.stream.Collectors.joining(","));
        this.associationStateHash = stateHash;
        this.associationTruncated = truncated;
        this.associationRefs = new ArrayList<>(refs);
    }
    public String getAssociationAnchors() { return associationAnchors; }
    public String getAssociationStateHash() { return associationStateHash; }
    public boolean isAssociationTruncated() { return Boolean.TRUE.equals(associationTruncated); }
    public List<AssociationRef> getAssociationRefs() { return associationRefs; }

    public void bindDiscoveryScope(String hash) { this.discoveryScopeHash = hash; }
    public String getDiscoveryScopeHash() { return discoveryScopeHash; }
    public String getSourceSelection() {
        if (discoveryScopeHash != null) return "FRESH_SEARCH";
        return parentReceiptId == null ? "UNRECORDED" : "FIXED_SOURCES";
    }

    public UUID getId() { return id; }
    public PrincipalRecord getPrincipal() { return principal; }
    public String getQueryHash() { return queryHash; }
    public String getPolicyVersion() { return policyVersion; }
    public RetrievalStatus getRecordedRetrievalStatus() {
        if (policyDecision == null) return legacyRetrievalStatus;
        try {
            return RetrievalStatus.valueOf(policyDecision);
        } catch (IllegalArgumentException unknownDecision) {
            // A newer decision can be audited by its originating policy. This build must require a retry.
            return null;
        }
    }
    public boolean isSemanticDegraded() { return Boolean.TRUE.equals(semanticDegraded); }
    public boolean isSourceSetNarrowed() { return Boolean.TRUE.equals(sourceSetNarrowed); }
    public String getRetrievalMode() { return retrievalMode; }
    public int getTokenBudget() { return tokenBudget; }
    public UUID getParentReceiptId() { return parentReceiptId; }
    public Instant getCreatedAt() { return createdAt; }
    public List<SourceRef> getSources() { return sources; }
    public Set<UUID> getProtectedRefs() { return protectedRefs; }

    public List<UUID> conflictRefs() {
        return sources.stream().filter(SourceRef::hasConflict).map(SourceRef::getMemoryId).toList();
    }

    public List<UUID> ambiguousRefs() {
        return sources.stream().filter(SourceRef::hasAmbiguousWeekday).map(SourceRef::getMemoryId).toList();
    }

    public enum RetrievalStatus {
        OK("ALLOW_ANSWER", "ANSWER"),
        NO_RESULTS("DO_NOT_ANSWER_CONFIDENTLY", "RETRY_RETRIEVAL"),
        PARTIAL_COVERAGE("DO_NOT_ANSWER_CONFIDENTLY", "RETRY_RETRIEVAL"),
        AMBIGUOUS_WEEKDAY("DO_NOT_ANSWER_CONFIDENTLY", "REQUIRE_CLARIFICATION"),
        CONFLICTING_CONTEXT("DO_NOT_ANSWER_CONFIDENTLY", "REQUIRE_CLARIFICATION"),
        STALE_CONTEXT("DO_NOT_ANSWER_CONFIDENTLY", "RETRY_RETRIEVAL"),
        RETRY_REQUIRED("DO_NOT_ANSWER_CONFIDENTLY", "RETRY_RETRIEVAL");

        public final String answerPolicy;
        public final String recommendedAction;

        RetrievalStatus(String answerPolicy, String recommendedAction) {
            this.answerPolicy = answerPolicy;
            this.recommendedAction = recommendedAction;
        }
    }

    /** Edge integrity includes the persisted owner/scope and both source incarnations. */
    @Embeddable
    public static class AssociationRef {
        @Column(name = "association_id", nullable = false)
        private UUID associationRef;
        @Column(name = "anchor_id", nullable = false)
        private UUID anchorId;
        @Column(name = "neighbor_id", nullable = false)
        private UUID memoryId;
        @Column(name = "association_hash", nullable = false, length = 64)
        private String associationHash;
        @Column(name = "anchor_source_hash", nullable = false, length = 64)
        private String anchorSourceHash;
        @Column(name = "neighbor_source_hash", nullable = false, length = 64)
        private String sourceHash;

        protected AssociationRef() {}
        public AssociationRef(UUID associationRef, UUID anchorId, UUID memoryId, String associationHash,
                              String anchorSourceHash, String sourceHash) {
            this.associationRef = associationRef;
            this.anchorId = anchorId;
            this.memoryId = memoryId;
            this.associationHash = associationHash;
            this.anchorSourceHash = anchorSourceHash;
            this.sourceHash = sourceHash;
        }
        public UUID getAssociationRef() { return associationRef; }
        public UUID getAnchorId() { return anchorId; }
        public UUID getMemoryId() { return memoryId; }
        public String getAssociationHash() { return associationHash; }
        public String getAnchorSourceHash() { return anchorSourceHash; }
        public String getSourceHash() { return sourceHash; }
    }

    @Embeddable
    public static class SourceRef {
        @Column(name = "memory_id", nullable = false)
        private UUID memoryId;

        @Column(name = "source_hash", nullable = false, length = 64)
        private String sourceHash;

        @Column(name = "explicit_conflict")
        private Boolean explicitConflict;

        @Column(name = "ambiguous_weekday")
        private Boolean ambiguousWeekday;

        protected SourceRef() {}

        public SourceRef(UUID memoryId, String sourceHash, boolean explicitConflict, boolean ambiguousWeekday) {
            this.memoryId = memoryId;
            this.sourceHash = sourceHash;
            this.explicitConflict = explicitConflict;
            this.ambiguousWeekday = ambiguousWeekday;
        }

        public UUID getMemoryId() { return memoryId; }
        public String getSourceHash() { return sourceHash; }
        public boolean hasAmbiguousWeekday() { return Boolean.TRUE.equals(ambiguousWeekday); }
        public boolean hasConflict() { return Boolean.TRUE.equals(explicitConflict); }
    }
}
