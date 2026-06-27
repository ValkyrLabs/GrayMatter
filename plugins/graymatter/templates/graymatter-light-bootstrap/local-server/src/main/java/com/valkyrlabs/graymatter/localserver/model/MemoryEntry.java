package com.valkyrlabs.graymatter.localserver.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "memory_entry")
public class MemoryEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "principal_id", nullable = false)
    private PrincipalRecord principal;

    @Column(nullable = false)
    private String type = "note";

    @Column(nullable = false, length = 16000)
    private String text;

    @Column(nullable = false)
    private String sourceChannel = "graymatter-local-server";

    @Column(length = 2048)
    private String tags = "";

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant modifiedAt;

    protected MemoryEntry() {
    }

    public MemoryEntry(PrincipalRecord principal, String type, String text, String sourceChannel, String tags) {
        this.principal = principal;
        this.type = type;
        this.text = text;
        this.sourceChannel = sourceChannel;
        this.tags = tags == null ? "" : tags;
    }

    @PrePersist
    void prePersist() {
        Instant now = Instant.now();
        this.createdAt = now;
        this.modifiedAt = now;
    }

    @PreUpdate
    void preUpdate() {
        this.modifiedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public PrincipalRecord getPrincipal() {
        return principal;
    }

    public String getType() {
        return type;
    }

    public String getText() {
        return text;
    }

    public String getSourceChannel() {
        return sourceChannel;
    }

    public String getTags() {
        return tags;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getModifiedAt() {
        return modifiedAt;
    }
}
