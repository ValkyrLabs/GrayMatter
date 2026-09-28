package com.valkyrlabs.graymatter.localserver.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.util.UUID;

/** Rebuildable, owner-scoped projection. MemoryEntry remains the canonical source. */
@Entity
@Table(name = "memory_search_index")
public class MemorySearchIndex {
    @Id
    private UUID memoryId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "principal_id", nullable = false)
    private PrincipalRecord principal;

    @Column(nullable = false, length = 64)
    private String sourceHash;

    @Column(nullable = false, length = 64)
    private String hashProfile;

    @Column(nullable = false, length = 4096)
    private String hashVector;

    @Column(length = 160)
    private String semanticProfile;

    @Column(length = 32768)
    private String semanticVector;

    protected MemorySearchIndex() {
    }

    public MemorySearchIndex(MemoryEntry entry, String sourceHash, String hashProfile,
                             String hashVector, String semanticProfile, String semanticVector) {
        this.memoryId = entry.getId();
        this.principal = entry.getPrincipal();
        this.sourceHash = sourceHash;
        this.hashProfile = hashProfile;
        this.hashVector = hashVector;
        this.semanticProfile = semanticProfile;
        this.semanticVector = semanticVector;
    }

    public UUID getMemoryId() { return memoryId; }
    public String getSourceHash() { return sourceHash; }
    public String getHashProfile() { return hashProfile; }
    public String getHashVector() { return hashVector; }
    public String getSemanticProfile() { return semanticProfile; }
    public String getSemanticVector() { return semanticVector; }
}
