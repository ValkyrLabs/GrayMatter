package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/memory-entries", "/MemoryEntry"})
public class MemoryEntryController {

    private final PrincipalRecordRepository principals;
    private final MemoryEntryRepository memoryEntries;

    public MemoryEntryController(PrincipalRecordRepository principals, MemoryEntryRepository memoryEntries) {
        this.principals = principals;
        this.memoryEntries = memoryEntries;
    }

    @GetMapping
    public List<MemoryEntryResponse> list(
        Principal authenticated,
        @RequestParam(name = "q", required = false) String query) {
        return memoryEntries.searchForPrincipal(authenticated.getName(), query, PageRequest.of(0, 50))
            .stream()
            .map(MemoryEntryResponse::from)
            .toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public MemoryEntryResponse create(
        Principal authenticated,
        @Valid @RequestBody CreateMemoryEntryRequest request) {
        PrincipalRecord principal = principals.findByUsernameIgnoreCase(authenticated.getName())
            .orElseThrow();
        MemoryEntry entry = new MemoryEntry(
            principal,
            request.type(),
            request.text(),
            request.sourceChannel() == null || request.sourceChannel().isBlank()
                ? "graymatter-local-server"
                : request.sourceChannel(),
            request.tags());
        return MemoryEntryResponse.from(memoryEntries.save(entry));
    }

    public record CreateMemoryEntryRequest(
        String type,
        @NotBlank String text,
        String sourceChannel,
        String tags) {
    }

    public record MemoryEntryResponse(
        UUID id,
        String type,
        String text,
        String sourceChannel,
        String tags,
        Instant createdAt,
        Instant modifiedAt) {
        static MemoryEntryResponse from(MemoryEntry entry) {
            return new MemoryEntryResponse(
                entry.getId(),
                entry.getType(),
                entry.getText(),
                entry.getSourceChannel(),
                entry.getTags(),
                entry.getCreatedAt(),
                entry.getModifiedAt());
        }
    }
}
