package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.KnowledgePackRecord;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface KnowledgePackRepository extends JpaRepository<KnowledgePackRecord, UUID> {

    Optional<KnowledgePackRecord> findByIdAndOwnerUsernameIgnoreCase(UUID id, String username);

    Optional<KnowledgePackRecord> findByOwnerUsernameIgnoreCaseAndSourcePackIdAndContentDigest(
        String username,
        UUID sourcePackId,
        String contentDigest);

    List<KnowledgePackSummaryView> findByOwnerUsernameIgnoreCaseOrderByImportedAtDesc(String username);

    long countByOwnerUsernameIgnoreCase(String username);

    interface KnowledgePackSummaryView {
        UUID getId();
        UUID getSourcePackId();
        String getName();
        String getFormatVersion();
        String getContentDigest();
        String getArchiveSha256();
        String getTrustModel();
        String getIdentityAssurance();
        int getObjectCount();
        int getEdgeCount();
        int getBlobCount();
        int getMemoryEntryCount();
        Instant getImportedAt();
    }
}
