package com.valkyrlabs.graymatter.localserver.controller;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.valkyrlabs.graymatter.localserver.controller.MemoryEntryController.MemoryEntryResponse;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemorySearchIndexRepository;
import com.valkyrlabs.graymatter.localserver.service.MemoryHybridSearchService;
import java.security.Principal;
import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Private Lite actions on the exact revision the caller read. */
@RestController
@RequestMapping("/v1/graymatter/memory/{id}")
public class MemoryMutationController {
    private static final Pattern SOURCE_HASH = Pattern.compile("[0-9a-f]{64}");
    private static final Set<String> REVISE_FIELDS = Set.of("expectedSourceHash", "text", "tags");
    private static final Set<String> FORGET_FIELDS = Set.of("expectedSourceHash", "confirmed");
    private final ObjectReader strictJson;
    private final MemoryEntryRepository memories;
    private final MemorySearchIndexRepository indexes;
    private final MemoryHybridSearchService search;

    public MemoryMutationController(ObjectMapper mapper, MemoryEntryRepository memories,
                                    MemorySearchIndexRepository indexes, MemoryHybridSearchService search) {
        this.strictJson = mapper.reader().with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
        this.memories = memories;
        this.indexes = indexes;
        this.search = search;
    }

    @GetMapping
    public MemoryEntryResponse read(Principal principal, @PathVariable UUID id) {
        return memories.findByIdAndPrincipalUsernameIgnoreCase(id, principal.getName()).map(MemoryEntryResponse::from)
            .orElseThrow(MemoryMutationController::notFound);
    }

    @Transactional
    @PostMapping(value = "/revise", consumes = MediaType.APPLICATION_JSON_VALUE)
    public MemoryEntryResponse revise(Principal principal, @PathVariable UUID id, @RequestBody String body) {
        JsonNode request = request(body, REVISE_FIELDS);
        if (!request.has("text") && !request.has("tags")) throw badRequest("Supply text or tags to revise");
        String text = null;
        if (request.has("text")) {
            text = request.get("text").textValue();
            if (text == null || text.isBlank() || text.length() > 16000) throw badRequest("Invalid memory text");
        }
        String tags = request.has("tags") ? normalizedTags(request.get("tags")) : null;
        MemoryEntry entry = current(principal, id, request.get("expectedSourceHash").textValue());
        String revisedText = text == null ? entry.getText() : text;
        String revisedTags = tags == null ? entry.getTags() : tags;
        if (!revisedText.equals(entry.getText()) || !Objects.equals(revisedTags, entry.getTags())) {
            entry.revise(revisedText, revisedTags);
            memories.saveAndFlush(entry);
            // Replace every old vector now. A configured semantic provider may fill its new vector on search.
            search.indexFeatureHash(entry);
        }
        return MemoryEntryResponse.from(entry);
    }

    @Transactional
    @PostMapping(value = "/forget", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void forget(Principal principal, @PathVariable UUID id, @RequestBody String body) {
        JsonNode request = request(body, FORGET_FIELDS);
        if (!request.path("confirmed").isBoolean() || !request.path("confirmed").booleanValue()) {
            throw badRequest("Forgetting this memory requires confirmed=true");
        }
        MemoryEntry entry = current(principal, id, request.get("expectedSourceHash").textValue());
        indexes.deleteById(entry.getId());
        memories.delete(entry);
    }

    private JsonNode request(String body, Set<String> fields) {
        JsonNode request;
        try {
            request = strictJson.readTree(body);
        } catch (JsonProcessingException e) {
            throw badRequest("Expected one JSON object with unique fields");
        }
        if (request == null || !request.isObject()) throw badRequest("Expected a JSON object");
        for (var names = request.fieldNames(); names.hasNext();) {
            if (!fields.contains(names.next())) throw badRequest("Unsupported memory mutation field");
        }
        String hash = request.path("expectedSourceHash").textValue();
        if (hash == null || !SOURCE_HASH.matcher(hash).matches()) throw badRequest("Invalid expectedSourceHash");
        return request;
    }

    private MemoryEntry current(Principal principal, UUID id, String expectedHash) {
        MemoryEntry entry = memories.lockOwned(id, principal.getName()).orElseThrow(MemoryMutationController::notFound);
        if (entry.getKnowledgePack() != null || entry.getSourceObjectId() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Individual memory actions cannot modify a signed knowledge pack");
        }
        if (!MemoryHybridSearchService.sourceHash(entry).equals(expectedHash)) {
            throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED, "Memory revision changed");
        }
        return entry;
    }

    private static String normalizedTags(JsonNode value) {
        if (!value.isArray() || value.size() > 50) throw badRequest("Invalid memory tags");
        Set<String> normalized = new LinkedHashSet<>();
        for (JsonNode tag : value) {
            String text = tag.textValue();
            if (text == null || text.isBlank() || text.length() > 128 || text.contains(",")) {
                throw badRequest("Invalid memory tag");
            }
            normalized.add(text.trim());
        }
        String csv = String.join(",", normalized);
        if (csv.length() > 2048) throw badRequest("Memory tags exceed local storage limit");
        return csv;
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "MemoryEntry not found");
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
