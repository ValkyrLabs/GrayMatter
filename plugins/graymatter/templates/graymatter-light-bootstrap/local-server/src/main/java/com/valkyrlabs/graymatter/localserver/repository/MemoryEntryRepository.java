package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface MemoryEntryRepository extends JpaRepository<MemoryEntry, UUID> {

    List<MemoryEntry> findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc(String username);

    Optional<MemoryEntry> findByIdAndPrincipalUsernameIgnoreCase(UUID id, String username);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        select m from MemoryEntry m where m.id = :id and m.principal.id =
        (select p.id from PrincipalRecord p where lower(p.username) = lower(:username))
        """)
    Optional<MemoryEntry> lockOwned(@Param("id") UUID id, @Param("username") String username);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        select m from MemoryEntry m where m.id = :id and m.principal.id = :ownerId
        and (m.revisionNonce = :revision or (m.revisionNonce is null and :revision is null))
        """)
    Optional<MemoryEntry> lockIndexRevision(@Param("id") UUID id, @Param("ownerId") UUID ownerId,
                                            @Param("revision") UUID revision);

    List<MemoryEntry> findByPrincipalUsernameIgnoreCaseAndIdIn(String username, List<UUID> ids);

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

    interface CandidateRevision {
        UUID getId();
        String getType();
        String getSourceChannel();
        String getTags();
        UUID getRevisionNonce();
    }

    @Query("""
        select m.id as id, m.type as type, m.sourceChannel as sourceChannel, m.tags as tags,
               m.revisionNonce as revisionNonce
        from MemoryEntry m where m.principal.id = :ownerId order by m.id
        """)
    java.util.stream.Stream<CandidateRevision> streamCandidateRevisions(@Param("ownerId") UUID ownerId);

    long countByPrincipalUsernameIgnoreCase(String username);
}
