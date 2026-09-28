package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MemoryRetrievalReceiptRepository extends JpaRepository<MemoryRetrievalReceipt, UUID> {
    Optional<MemoryRetrievalReceipt> findByIdAndPrincipalUsernameIgnoreCase(UUID id, String username);
}
