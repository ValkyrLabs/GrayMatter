package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MemoryEntryRepository extends JpaRepository<MemoryEntry, UUID> {

    @Query("""
        select entry from MemoryEntry entry
        where lower(entry.principal.username) = lower(:username)
          and (
            :query is null
            or :query = ''
            or lower(entry.text) like lower(concat('%', :query, '%'))
            or lower(entry.type) like lower(concat('%', :query, '%'))
            or lower(entry.tags) like lower(concat('%', :query, '%'))
          )
        order by entry.createdAt desc
        """)
    List<MemoryEntry> searchForPrincipal(
        @Param("username") String username,
        @Param("query") String query,
        Pageable pageable);

    long countByPrincipalUsernameIgnoreCase(String username);
}
