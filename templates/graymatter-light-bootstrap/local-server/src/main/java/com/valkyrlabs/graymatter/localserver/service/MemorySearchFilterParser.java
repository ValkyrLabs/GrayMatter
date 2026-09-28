package com.valkyrlabs.graymatter.localserver.service;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Reject unsupported Cloud filters instead of accidentally broadening a Lite retrieval. */
public final class MemorySearchFilterParser {
    private static final Set<String> ALLOWED = Set.of("type", "source", "sourceChannel", "tags");

    private MemorySearchFilterParser() {}

    public static Filters merge(String type, String source, List<String> tags, JsonNode filters) {
        if (filters == null || filters.isNull()) return new Filters(type, source, safeTags(tags));
        if (!filters.isObject()) throw new IllegalArgumentException("filters must be an object");
        Iterator<String> names = filters.fieldNames();
        while (names.hasNext()) {
            if (!ALLOWED.contains(names.next())) {
                throw new IllegalArgumentException("Unsupported Lite memory filter");
            }
        }
        String nestedType = text(filters.path("type"));
        String nestedSource = text(filters.path("source"));
        String nestedSourceChannel = text(filters.path("sourceChannel"));
        if (nestedSource != null && nestedSourceChannel != null
            && !nestedSource.equalsIgnoreCase(nestedSourceChannel)) {
            throw new IllegalArgumentException("Conflicting source filters");
        }
        nestedSource = nestedSource == null ? nestedSourceChannel : nestedSource;
        if (type != null && nestedType != null && !type.equalsIgnoreCase(nestedType)) {
            throw new IllegalArgumentException("Conflicting type filters");
        }
        if (source != null && nestedSource != null && !source.equalsIgnoreCase(nestedSource)) {
            throw new IllegalArgumentException("Conflicting source filters");
        }
        List<String> mergedTags = new ArrayList<>(safeTags(tags));
        JsonNode nestedTags = filters.path("tags");
        if (!nestedTags.isMissingNode() && !nestedTags.isNull()) {
            if (!nestedTags.isArray()) throw new IllegalArgumentException("tags filter must be an array");
            for (JsonNode tag : nestedTags) {
                if (!tag.isTextual() || tag.asText().isBlank()) {
                    throw new IllegalArgumentException("tags filter contains an invalid tag");
                }
                mergedTags.add(tag.asText());
            }
        }
        if (mergedTags.size() > 50) throw new IllegalArgumentException("Too many tag filters");
        return new Filters(type == null ? nestedType : type,
            source == null ? nestedSource : source, List.copyOf(mergedTags));
    }

    private static String text(JsonNode node) {
        if (node.isMissingNode() || node.isNull()) return null;
        if (!node.isTextual() || node.asText().isBlank()) {
            throw new IllegalArgumentException("Memory filter must be nonblank text");
        }
        return node.asText().trim();
    }

    private static List<String> safeTags(List<String> tags) {
        if (tags == null) return List.of();
        if (tags.size() > 50 || tags.stream().anyMatch(tag -> tag == null || tag.isBlank())) {
            throw new IllegalArgumentException("Invalid tag filters");
        }
        return tags;
    }

    public record Filters(String type, String source, List<String> tags) {}
}
