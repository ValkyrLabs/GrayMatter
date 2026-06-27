package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import jakarta.validation.Valid;
import java.security.Principal;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/v1/MemoryEntry")
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

    @GetMapping("/{id}")
    public MemoryEntryResponse read(Principal authenticated, @PathVariable UUID id) {
        return memoryEntries.findById(id)
            .filter(entry -> entry.getPrincipal().getUsername().equalsIgnoreCase(authenticated.getName()))
            .map(MemoryEntryResponse::from)
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "MemoryEntry not found"));
    }

    @PostMapping("/read")
    public List<MemoryEntryResponse> read(Principal authenticated, @RequestBody(required = false) MemoryQueryRequest request) {
        return query(authenticated, request == null ? new MemoryQueryRequest(null, null, null, null, null, null, null) : request).results();
    }

    @PostMapping("/query")
    public MemoryQueryResponse query(Principal authenticated, @RequestBody(required = false) MemoryQueryRequest request) {
        MemoryQueryRequest safeRequest = request == null
            ? new MemoryQueryRequest(null, null, null, null, null, null, null)
            : request;
        String query = firstNonBlank(safeRequest.query(), safeRequest.q(), safeRequest.keyword());
        Integer requestedLimit = safeRequest.limit() == null ? safeRequest.maxResults() : safeRequest.limit();
        int limit = Math.max(1, Math.min(requestedLimit == null ? 25 : requestedLimit, 100));
        List<MemoryEntryResponse> results = memoryEntries.searchForPrincipal(authenticated.getName(), query, PageRequest.of(0, limit))
            .stream()
            .map(MemoryEntryResponse::from)
            .toList();
        return new MemoryQueryResponse(results);
    }

    @PostMapping({"", "/write"})
    public MemoryEntryResponse create(
        Principal authenticated,
        @Valid @RequestBody CreateMemoryEntryRequest request) {
        PrincipalRecord principal = principals.findByUsernameIgnoreCase(authenticated.getName())
            .orElseThrow();
        String text = firstNonBlank(request.text(), request.content());
        if (text == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "MemoryEntry text or content is required");
        }
        MemoryEntry entry = new MemoryEntry(
            principal,
            firstNonBlank(request.type(), "context"),
            text,
            firstNonBlank(request.sourceChannel(), request.source()) == null
                ? "graymatter-local-server"
                : firstNonBlank(request.sourceChannel(), request.source()),
            normalizeTags(request.tags()));
        return MemoryEntryResponse.from(memoryEntries.save(entry));
    }

    public record CreateMemoryEntryRequest(
        String type,
        String text,
        String content,
        String title,
        List<String> tags,
        String sourceChannel,
        String source) {
    }

    public record MemoryQueryRequest(
        String query,
        String q,
        String keyword,
        Integer limit,
        Integer maxResults,
        String type,
        String source) {
    }

    public record MemoryQueryResponse(List<MemoryEntryResponse> results) {
    }

    public record MemoryEntryResponse(
        UUID id,
        String type,
        String text,
        String sourceChannel,
        String tags,
        Instant createdDate,
        Instant lastModifiedDate) {
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

    private static String firstNonBlank(String... values) {
        return Arrays.stream(values == null ? new String[0] : values)
            .filter(value -> value != null && !value.isBlank())
            .findFirst()
            .orElse(null);
    }

    private static String normalizeTags(List<String> tags) {
        if (tags == null || tags.isEmpty()) {
            return "";
        }
        return String.join(",", tags.stream()
            .filter(tag -> tag != null && !tag.isBlank())
            .map(String::trim)
            .distinct()
            .toList());
    }
}
