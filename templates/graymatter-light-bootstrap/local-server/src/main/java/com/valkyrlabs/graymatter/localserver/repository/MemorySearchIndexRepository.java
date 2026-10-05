package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.MemorySearchIndex;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MemorySearchIndexRepository extends JpaRepository<MemorySearchIndex, UUID> {
    List<MemorySearchIndex> findByPrincipalUsernameIgnoreCase(String username);
}
