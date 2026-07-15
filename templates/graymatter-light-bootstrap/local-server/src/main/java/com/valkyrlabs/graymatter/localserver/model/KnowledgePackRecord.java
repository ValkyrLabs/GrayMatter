package com.valkyrlabs.graymatter.localserver.model;

import jakarta.persistence.Basic;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
    name = "knowledge_pack",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_knowledge_pack_owner_source_digest",
        columnNames = {"owner_id", "source_pack_id", "content_digest"}))
public class KnowledgePackRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    private PrincipalRecord owner;

    @Column(name = "source_pack_id", nullable = false)
    private UUID sourcePackId;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(nullable = false, length = 32)
    private String formatVersion;

    @Column(name = "content_digest", nullable = false, length = 64)
    private String contentDigest;

    @Column(nullable = false, length = 64)
    private String archiveSha256;

    @Column(nullable = false, length = 64)
    private String trustModel;

    @Column(nullable = false, length = 128)
    private String identityAssurance;

    @Column(nullable = false)
    private int objectCount;

    @Column(nullable = false)
    private int edgeCount;

    @Column(nullable = false)
    private int blobCount;

    @Column(nullable = false)
    private int memoryEntryCount;

    @Lob
    @Basic(fetch = FetchType.LAZY)
    @Column(nullable = false)
    private String manifestJson;

    @Lob
    @Basic(fetch = FetchType.LAZY)
    @Column(nullable = false)
    private String objectsJsonl;

    @Lob
    @Basic(fetch = FetchType.LAZY)
    @Column(nullable = false)
    private String edgesJsonl;

    @Lob
    @Basic(fetch = FetchType.LAZY)
    @Column(nullable = false)
    private String signatureJson;

    @Basic(fetch = FetchType.LAZY)
    @Column(nullable = false, columnDefinition = "bytea")
    private byte[] archiveBytes;

    @Column(nullable = false, updatable = false)
    private Instant importedAt;

    protected KnowledgePackRecord() {
    }

    public KnowledgePackRecord(
        PrincipalRecord owner,
        UUID sourcePackId,
        String name,
        String formatVersion,
        String contentDigest,
        String archiveSha256,
        String trustModel,
        String identityAssurance,
        int objectCount,
        int edgeCount,
        int blobCount,
        int memoryEntryCount,
        String manifestJson,
        String objectsJsonl,
        String edgesJsonl,
        String signatureJson,
        byte[] archiveBytes) {
        this.owner = owner;
        this.sourcePackId = sourcePackId;
        this.name = name;
        this.formatVersion = formatVersion;
        this.contentDigest = contentDigest;
        this.archiveSha256 = archiveSha256;
        this.trustModel = trustModel;
        this.identityAssurance = identityAssurance;
        this.objectCount = objectCount;
        this.edgeCount = edgeCount;
        this.blobCount = blobCount;
        this.memoryEntryCount = memoryEntryCount;
        this.manifestJson = manifestJson;
        this.objectsJsonl = objectsJsonl;
        this.edgesJsonl = edgesJsonl;
        this.signatureJson = signatureJson;
        this.archiveBytes = archiveBytes.clone();
    }

    @PrePersist
    void prePersist() {
        this.importedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public PrincipalRecord getOwner() { return owner; }
    public UUID getSourcePackId() { return sourcePackId; }
    public String getName() { return name; }
    public String getFormatVersion() { return formatVersion; }
    public String getContentDigest() { return contentDigest; }
    public String getArchiveSha256() { return archiveSha256; }
    public String getTrustModel() { return trustModel; }
    public String getIdentityAssurance() { return identityAssurance; }
    public int getObjectCount() { return objectCount; }
    public int getEdgeCount() { return edgeCount; }
    public int getBlobCount() { return blobCount; }
    public int getMemoryEntryCount() { return memoryEntryCount; }
    public String getManifestJson() { return manifestJson; }
    public String getObjectsJsonl() { return objectsJsonl; }
    public String getEdgesJsonl() { return edgesJsonl; }
    public String getSignatureJson() { return signatureJson; }
    public byte[] getArchiveBytes() { return archiveBytes.clone(); }
    public Instant getImportedAt() { return importedAt; }
}
