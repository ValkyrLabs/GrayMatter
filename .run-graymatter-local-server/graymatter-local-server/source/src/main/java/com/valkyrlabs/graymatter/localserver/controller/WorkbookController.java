package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.model.WorkbookRecord;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.repository.WorkbookRecordRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/Workbook")
public class WorkbookController {

    private final PrincipalRecordRepository principals;
    private final WorkbookRecordRepository workbooks;

    public WorkbookController(PrincipalRecordRepository principals, WorkbookRecordRepository workbooks) {
        this.principals = principals;
        this.workbooks = workbooks;
    }

    @GetMapping
    public List<WorkbookResponse> list(Principal authenticated) {
        return workbooks.findByOwnerUsernameIgnoreCaseOrderByCreatedAtDesc(authenticated.getName())
            .stream()
            .map(WorkbookResponse::from)
            .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public WorkbookResponse create(Principal authenticated, @Valid @RequestBody CreateWorkbookRequest request) {
        PrincipalRecord owner = principals.findByUsernameIgnoreCase(authenticated.getName())
            .orElseThrow();
        WorkbookRecord workbook = new WorkbookRecord(owner, request.name(), request.status());
        return WorkbookResponse.from(workbooks.save(workbook));
    }

    @GetMapping("/{id}")
    public WorkbookResponse get(Principal authenticated, @PathVariable UUID id) {
        WorkbookRecord workbook = workbooks.findById(id)
            .filter(record -> record.getOwner().getUsername().equalsIgnoreCase(authenticated.getName()))
            .orElseThrow();
        return WorkbookResponse.from(workbook);
    }

    public record CreateWorkbookRequest(@NotBlank String name, String status) {
    }

    public record WorkbookResponse(
        UUID id,
        String name,
        String status,
        String ownerUsername,
        Instant createdAt,
        Instant modifiedAt) {
        static WorkbookResponse from(WorkbookRecord workbook) {
            return new WorkbookResponse(
                workbook.getId(),
                workbook.getName(),
                workbook.getStatus(),
                workbook.getOwner().getUsername(),
                workbook.getCreatedAt(),
                workbook.getModifiedAt());
        }
    }
}
