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
@Table(name = "workbook")
public class WorkbookRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "owner_principal_id", nullable = false)
    private PrincipalRecord owner;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String status = "WorkbookOpen";

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant modifiedAt;

    protected WorkbookRecord() {
    }

    public WorkbookRecord(PrincipalRecord owner, String name, String status) {
        this.owner = owner;
        this.name = name;
        this.status = status == null || status.isBlank() ? "WorkbookOpen" : status;
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

    public PrincipalRecord getOwner() {
        return owner;
    }

    public String getName() {
        return name;
    }

    public String getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getModifiedAt() {
        return modifiedAt;
    }
}
