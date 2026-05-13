package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PrincipalRecordRepository extends JpaRepository<PrincipalRecord, UUID> {
    Optional<PrincipalRecord> findByUsernameIgnoreCase(String username);
}
