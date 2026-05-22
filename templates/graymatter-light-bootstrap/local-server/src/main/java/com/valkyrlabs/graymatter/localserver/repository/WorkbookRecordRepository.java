package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.WorkbookRecord;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkbookRecordRepository extends JpaRepository<WorkbookRecord, UUID> {
    List<WorkbookRecord> findByOwnerUsernameIgnoreCaseOrderByCreatedAtDesc(String username);

    long countByOwnerUsernameIgnoreCase(String username);
}
