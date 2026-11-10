package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.MemorySearchIndex;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MemorySearchIndexRepository extends JpaRepository<MemorySearchIndex, UUID> {
    List<MemorySearchIndex> findByPrincipalUsernameIgnoreCase(String username);

    List<MemorySearchIndex> findByPrincipalUsernameIgnoreCaseAndMemoryIdIn(String username, List<UUID> memoryIds);

    @Modifying(flushAutomatically = true)
    @Query("""
        delete from MemorySearchIndex idx
        where idx.principal.id = (select p.id from PrincipalRecord p where lower(p.username) = lower(:username))
        and not exists (select m.id from MemoryEntry m where m.id = idx.memoryId and m.principal.id = idx.principal.id)
        """)
    int deleteOrphans(@Param("username") String username);
}
