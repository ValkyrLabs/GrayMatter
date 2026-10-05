package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.MemorySearchIndex;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemorySearchIndexRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Owner-scoped portable sparse/dense retrieval; H2 is the durable index store. */
@Service
public class MemoryHybridSearchService {
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]+", Pattern.UNICODE_CHARACTER_CLASS);
    private static final double K1 = 1.2;
    private static final double B = 0.75;
    private final MemoryEntryRepository memories;
    private final MemorySearchIndexRepository indexes;
    private final LocalMemoryEmbeddingService embeddings;

    public MemoryHybridSearchService(MemoryEntryRepository memories, MemorySearchIndexRepository indexes,
                                     LocalMemoryEmbeddingService embeddings) {
        this.memories = memories;
        this.indexes = indexes;
        this.embeddings = embeddings;
    }

    @Transactional
    public void index(MemoryEntry entry) {
        if (entry.getId() == null) throw new IllegalArgumentException("MemoryEntry must be saved before indexing");
        writeIndex(entry, null, true);
    }

    @Transactional
    public void indexFeatureHash(MemoryEntry entry) {
        if (entry.getId() == null) throw new IllegalArgumentException("MemoryEntry must be saved before indexing");
        writeIndex(entry, null, false);
    }

    @Transactional
    public ReindexResult reindex(String username) {
        List<MemoryEntry> entries = memories.findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc(username);
        Map<UUID, MemorySearchIndex> existing = ownerIndexes(username);
        Set<UUID> live = new HashSet<>();
        int updated = 0;
        int semantic = 0;
        for (MemoryEntry entry : entries) {
            live.add(entry.getId());
            MemorySearchIndex row = writeIndex(entry, existing.get(entry.getId()), true);
            updated++;
            if (row.getSemanticVector() != null) semantic++;
        }
        int deleted = 0;
        for (MemorySearchIndex row : existing.values()) {
            if (!live.contains(row.getMemoryId())) {
                indexes.delete(row);
                deleted++;
            }
        }
        return new ReindexResult(updated, semantic, deleted, embeddings.semanticConfigured()
            ? embeddings.semanticProfile() : LocalMemoryEmbeddingService.HASH_PROFILE, false, entries.size());
    }

    @Transactional(readOnly = true)
    public ReindexResult estimateReindex(String username) {
        int candidates = memories.findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc(username).size();
        return new ReindexResult(0, 0, 0, embeddings.semanticConfigured()
            ? embeddings.semanticProfile() : LocalMemoryEmbeddingService.HASH_PROFILE, true, candidates);
    }

    @Transactional
    public SearchResponse search(String username, SearchRequest request) {
        String query = request.query() == null ? "" : request.query().trim();
        if (query.length() > 1000) throw new IllegalArgumentException("query exceeds 1000 characters");
        int limit = Math.max(1, Math.min(request.limit(), 100));
        String mode = normalizeMode(request.mode());
        if (query.isBlank() && (request.type() == null || request.type().isBlank())
            && (request.source() == null || request.source().isBlank())
            && (request.tags() == null || request.tags().isEmpty())) {
            List<SearchHit> recent = memories.searchForPrincipal(username, null, PageRequest.of(0, limit))
                .stream().map(entry -> new SearchHit(entry, 0, 0, 0, "RECENT", sourceHash(entry)))
                .toList();
            return new SearchResponse(recent, "RECENT", LocalMemoryEmbeddingService.HASH_PROFILE, false);
        }
        List<MemoryEntry> candidates = memories.findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc(username)
            .stream().filter(entry -> matchesFilters(entry, request)).toList();
        if (query.isBlank()) {
            List<SearchHit> recent = candidates.stream()
                .sorted(Comparator.comparing(MemoryEntry::getCreatedAt).reversed().thenComparing(MemoryEntry::getId))
                .limit(limit).map(entry -> new SearchHit(entry, 0, 0, 0, "RECENT", sourceHash(entry)))
                .toList();
            return new SearchResponse(recent, "RECENT", LocalMemoryEmbeddingService.HASH_PROFILE, false);
        }

        float[] queryHash = embeddings.featureHash(query);
        float[] querySemantic = mode.equals("KEYWORD") ? null : embeddings.semantic(query);
        boolean semanticActive = querySemantic != null;
        Map<UUID, MemorySearchIndex> existing = ownerIndexes(username);
        List<Scored> scored = new ArrayList<>();
        List<String> queryWords = tokens(query);
        Map<String, Integer> documentFrequency = documentFrequency(candidates, queryWords);
        double averageLength = candidates.stream().mapToInt(entry -> tokens(searchText(entry)).size())
            .average().orElse(1.0);
        for (MemoryEntry entry : candidates) {
            MemorySearchIndex row = writeIndex(entry, existing.get(entry.getId()), semanticActive);
            double lexical = bm25(searchText(entry), queryWords, documentFrequency,
                candidates.size(), averageLength);
            float[] vector = semanticActive && embeddings.semanticProfile().equals(row.getSemanticProfile())
                ? LocalMemoryEmbeddingService.decode(row.getSemanticVector()) : null;
            double dense = vector == null
                ? LocalMemoryEmbeddingService.cosine(queryHash,
                    LocalMemoryEmbeddingService.decode(row.getHashVector()))
                : LocalMemoryEmbeddingService.cosine(querySemantic, vector);
            // Feature hashing is a lexical approximation, so avoid weak accidental collisions.
            if (vector == null && dense < 0.12) dense = 0;
            if (lexical > 0 || dense > 0) scored.add(new Scored(entry, lexical, dense, sourceHash(entry)));
        }
        Map<UUID, Integer> sparseRank = ranks(scored, true);
        Map<UUID, Integer> denseRank = ranks(scored, false);
        List<SearchHit> hits = scored.stream().map(item -> {
            double score = 0;
            if (!mode.equals("VECTOR") && item.lexical() > 0) {
                score += 1.0 / (60 + sparseRank.get(item.entry().getId()));
            }
            if (!mode.equals("KEYWORD") && item.dense() > 0) {
                score += 1.0 / (60 + denseRank.get(item.entry().getId()));
            }
            if (mode.equals("RECENCY_BIASED")) {
                long ageDays = Math.max(0, Duration.between(item.entry().getCreatedAt(), Instant.now()).toDays());
                score += 0.005 * Math.exp(-ageDays / 30.0);
            }
            return new SearchHit(item.entry(), item.lexical(), item.dense(), score,
                item.lexical() > 0 && item.dense() > 0 ? "HYBRID"
                    : item.dense() > 0 ? "VECTOR" : "KEYWORD", item.sourceHash());
        }).filter(hit -> hit.score() > 0)
            .sorted(Comparator.comparingDouble(SearchHit::score).reversed()
                .thenComparing(hit -> hit.entry().getCreatedAt(), Comparator.reverseOrder())
                .thenComparing(hit -> hit.entry().getId()))
            .limit(limit).toList();
        return new SearchResponse(hits, mode,
            semanticActive ? embeddings.semanticProfile() : LocalMemoryEmbeddingService.HASH_PROFILE,
            embeddings.semanticConfigured() && !semanticActive);
    }

    public static String sourceHash(MemoryEntry entry) {
        String content = entry.getType() + "\n" + entry.getText() + "\n"
            + entry.getTags() + "\n" + entry.getSourceChannel();
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(content.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private MemorySearchIndex writeIndex(MemoryEntry entry, MemorySearchIndex existing,
                                         boolean trySemantic) {
        String hash = sourceHash(entry);
        String profile = embeddings.semanticConfigured() ? embeddings.semanticProfile() : null;
        if (existing != null && hash.equals(existing.getSourceHash())
            && LocalMemoryEmbeddingService.HASH_PROFILE.equals(existing.getHashProfile())
            && (!trySemantic || profile == null || profile.equals(existing.getSemanticProfile()))) {
            return existing;
        }
        float[] semantic = trySemantic && embeddings.semanticConfigured()
            ? embeddings.semantic(entry.getText()) : null;
        // A failed model call leaves the durable feature-hash projection usable.
        MemorySearchIndex row = new MemorySearchIndex(entry, hash,
            LocalMemoryEmbeddingService.HASH_PROFILE,
            LocalMemoryEmbeddingService.encode(embeddings.featureHash(searchText(entry))),
            semantic == null ? null : profile,
            semantic == null ? null : LocalMemoryEmbeddingService.encode(semantic));
        return indexes.save(row);
    }

    private Map<UUID, MemorySearchIndex> ownerIndexes(String username) {
        Map<UUID, MemorySearchIndex> result = new HashMap<>();
        indexes.findByPrincipalUsernameIgnoreCase(username).forEach(row -> result.put(row.getMemoryId(), row));
        return result;
    }

    private static boolean matchesFilters(MemoryEntry entry, SearchRequest request) {
        if (request.type() != null && !request.type().isBlank()
            && !entry.getType().equalsIgnoreCase(request.type())) return false;
        if (request.source() != null && !request.source().isBlank()
            && !entry.getSourceChannel().equalsIgnoreCase(request.source())) return false;
        if (request.tags() != null && !request.tags().isEmpty()) {
            Set<String> available = new HashSet<>();
            for (String tag : entry.getTags().split(",")) available.add(tag.trim().toLowerCase(Locale.ROOT));
            for (String tag : request.tags()) {
                if (tag != null && !available.contains(tag.trim().toLowerCase(Locale.ROOT))) return false;
            }
        }
        return true;
    }

    private static String normalizeMode(String mode) {
        if (mode == null || mode.isBlank()) return "HYBRID";
        String normalized = mode.toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "VECTOR", "KEYWORD", "HYBRID", "SCHEMA_FILTERED", "RECENCY_BIASED" -> normalized;
            default -> throw new IllegalArgumentException("Unsupported retrieval mode");
        };
    }

    private static String searchText(MemoryEntry entry) {
        return entry.getText() + " " + entry.getType() + " " + entry.getTags();
    }

    private static List<String> tokens(String value) {
        List<String> result = new ArrayList<>();
        Matcher matcher = WORD.matcher(value.toLowerCase(Locale.ROOT));
        while (matcher.find()) result.add(matcher.group());
        return result;
    }

    private static Map<String, Integer> documentFrequency(List<MemoryEntry> entries, List<String> query) {
        Map<String, Integer> result = new HashMap<>();
        Set<String> queryTerms = new HashSet<>(query);
        for (MemoryEntry entry : entries) {
            Set<String> words = new HashSet<>(tokens(searchText(entry)));
            for (String term : queryTerms) if (words.contains(term)) result.merge(term, 1, Integer::sum);
        }
        return result;
    }

    private static double bm25(String text, List<String> query, Map<String, Integer> df,
                               int corpusSize, double averageLength) {
        List<String> words = tokens(text);
        Map<String, Integer> frequencies = new HashMap<>();
        words.forEach(word -> frequencies.merge(word, 1, Integer::sum));
        double score = 0;
        for (String term : new HashSet<>(query)) {
            int frequency = frequencies.getOrDefault(term, 0);
            if (frequency == 0) continue;
            double idf = Math.log(1.0 + (corpusSize - df.getOrDefault(term, 0) + 0.5)
                / (df.getOrDefault(term, 0) + 0.5));
            score += idf * frequency * (K1 + 1)
                / (frequency + K1 * (1 - B + B * words.size() / Math.max(1, averageLength)));
        }
        return score;
    }

    private static Map<UUID, Integer> ranks(List<Scored> items, boolean lexical) {
        List<Scored> ordered = items.stream().filter(item -> lexical ? item.lexical() > 0 : item.dense() > 0)
            .sorted(Comparator.comparingDouble((Scored item) -> lexical ? item.lexical() : item.dense())
                .reversed().thenComparing(item -> item.entry().getId())).toList();
        Map<UUID, Integer> result = new HashMap<>();
        for (int i = 0; i < ordered.size(); i++) result.put(ordered.get(i).entry().getId(), i + 1);
        return result;
    }

    public record SearchRequest(String query, int limit, String mode, String type, String source,
                                List<String> tags) {}
    public record SearchHit(MemoryEntry entry, double lexicalScore, double vectorScore,
                            double score, String matchTier, String sourceHash) {}
    public record SearchResponse(List<SearchHit> hits, String retrievalMode, String vectorProfile,
                                 boolean semanticDegraded) {}
    public record ReindexResult(int indexed, int semanticIndexed, int deletedStale,
                                String vectorProfile, boolean dryRun, int candidateCount) {}
    private record Scored(MemoryEntry entry, double lexical, double dense, String sourceHash) {}
}
