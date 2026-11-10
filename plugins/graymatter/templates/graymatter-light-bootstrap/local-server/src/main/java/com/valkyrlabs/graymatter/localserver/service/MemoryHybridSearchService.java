package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.MemorySearchIndex;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemorySearchIndexRepository;
import java.nio.ByteBuffer;
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
    private static final int INDEX_ID_BATCH_SIZE = 512;
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
        updateIndexes(List.of(entry), Map.of(), true);
    }

    @Transactional
    public void indexFeatureHash(MemoryEntry entry) {
        if (entry.getId() == null) throw new IllegalArgumentException("MemoryEntry must be saved before indexing");
        updateIndexes(List.of(entry), Map.of(), false);
    }

    @Transactional
    public ReindexResult reindex(String username) {
        List<MemoryEntry> entries = memories.findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc(username);
        Map<UUID, MemorySearchIndex> ready = updateIndexes(entries, ownerIndexes(username), true);
        int semantic = (int) ready.values().stream().filter(row -> row.getSemanticVector() != null).count();
        // Check current source existence in the delete statement itself. A source created between
        // the two reads above must keep the index committed with it.
        int deleted = indexes.deleteOrphans(username);
        return new ReindexResult(ready.size(), semantic, deleted, embeddings.semanticConfigured()
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
        return search(username, request, false);
    }

    @Transactional
    public SearchResponse searchForContext(String username, SearchRequest request) {
        return search(username, request, true);
    }

    @Transactional
    public SearchResponse searchForAssociationContext(String username, SearchRequest request) {
        return search(username, request, true, true);
    }

    private SearchResponse search(String username, SearchRequest request, boolean checkConflictWitness) {
        return search(username, request, checkConflictWitness, false);
    }

    private SearchResponse search(String username, SearchRequest request, boolean checkConflictWitness,
                                  boolean associationRecall) {
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
            return new SearchResponse(recent, "RECENT", LocalMemoryEmbeddingService.HASH_PROFILE, false, null, List.of());
        }
        List<MemoryEntry> owned = memories.findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc(username);
        List<MemoryEntry> candidates = owned.stream().filter(entry -> matchesFilters(entry, request)).toList();
        if (query.isBlank()) {
            List<SearchHit> recent = candidates.stream()
                .sorted(Comparator.comparing(MemoryEntry::getCreatedAt).reversed().thenComparing(MemoryEntry::getId))
                .limit(limit).map(entry -> new SearchHit(entry, 0, 0, 0, "RECENT", sourceHash(entry)))
                .toList();
            return new SearchResponse(recent, "RECENT", LocalMemoryEmbeddingService.HASH_PROFILE, false, null, List.of());
        }

        float[] queryHash = embeddings.featureHash(query);
        var queryFeatures = LocalMemoryEmbeddingService.LexicalFeatures.from(query);
        float[] querySemantic = mode.equals("KEYWORD") ? null : embeddings.semantic(query);
        boolean semanticActive = querySemantic != null;
        boolean semanticDegraded = !mode.equals("KEYWORD") && embeddings.semanticConfigured() && !semanticActive;
        Map<UUID, MemorySearchIndex> existing = candidates.size() * 2L <= owned.size()
            ? candidateIndexes(username, candidates) : ownerIndexes(username);
        Map<UUID, MemorySearchIndex> ready = updateIndexes(candidates, existing, semanticActive);
        List<Scored> scored = new ArrayList<>();
        List<String> queryWords = tokens(query);
        Map<String, Integer> documentFrequency = documentFrequency(candidates, queryWords);
        double averageLength = candidates.stream().mapToInt(entry -> tokens(searchText(entry)).size())
            .average().orElse(1.0);
        for (MemoryEntry entry : candidates) {
            MemorySearchIndex row = ready.get(entry.getId());
            if (row == null) continue;
            double lexical = bm25(searchText(entry), queryWords, documentFrequency,
                candidates.size(), averageLength);
            float[] vector = semanticActive && embeddings.semanticProfile().equals(row.getSemanticProfile())
                ? LocalMemoryEmbeddingService.decode(row.getSemanticVector()) : null;
            if (semanticActive && (vector == null || vector.length != querySemantic.length)) {
                vector = null;
                semanticDegraded = true;
            }
            double dense = vector == null
                ? LocalMemoryEmbeddingService.cosine(queryHash,
                    LocalMemoryEmbeddingService.decode(row.getHashVector()))
                : LocalMemoryEmbeddingService.cosine(querySemantic, vector);
            if (vector == null) {
                // Confirm a hash-only hit against the actual features. Disjoint words
                // can otherwise share buckets and qualify as the best evidence.
                if (lexical == 0 && dense >= 0.12) dense = queryFeatures.cosineWith(searchText(entry));
                if (dense < 0.12) dense = 0;
            }
            if (lexical > 0 || dense > 0) scored.add(new Scored(entry, lexical, dense, sourceHash(entry)));
        }
        Map<UUID, Integer> sparseRank = ranks(scored, true);
        Map<UUID, Integer> denseRank = ranks(scored, false);
        // The offline vector is a sketch of the same words and trigrams, not
        // independent semantic evidence. Preserve BM25 order where words
        // match; use confirmed subword neighbors to fill otherwise empty slots.
        boolean lexicalFirst = !semanticActive && (mode.equals("HYBRID") || mode.equals("SCHEMA_FILTERED"));
        var ranked = scored.stream().map(item -> {
            double score = 0;
            if (!mode.equals("VECTOR") && item.lexical() > 0) {
                score += 1.0 / (60 + sparseRank.get(item.entry().getId()));
            }
            if (!mode.equals("KEYWORD") && item.dense() > 0 && !(lexicalFirst && item.lexical() > 0)) {
                score += 1.0 / (60.0 + (lexicalFirst ? sparseRank.size() : 0) + denseRank.get(item.entry().getId()));
            }
            if (mode.equals("RECENCY_BIASED")) {
                long ageDays = Math.max(0, Duration.between(item.entry().getCreatedAt(), Instant.now()).toDays());
                score += 0.005 * Math.exp(-ageDays / 30.0);
            }
            return new SearchHit(item.entry(), item.lexical(), item.dense(), score,
                lexicalFirst && item.lexical() > 0 ? "KEYWORD" : item.lexical() > 0 && item.dense() > 0 ? "HYBRID"
                    : item.dense() > 0 ? "VECTOR" : "KEYWORD", item.sourceHash());
        }).filter(hit -> hit.score() > 0)
            .sorted(Comparator.comparingDouble(SearchHit::score).reversed()
                .thenComparing(hit -> hit.entry().getCreatedAt(), Comparator.reverseOrder())
                .thenComparing(hit -> hit.entry().getId())).toList();
        int cutoff = Math.min(ranked.size(), limit);
        List<SearchHit> hits = ranked.subList(0, cutoff);
        List<SearchHit> remaining = ranked.subList(cutoff, ranked.size());
        SearchHit witness = null;
        List<SearchHit> ambiguous = List.of();
        if (checkConflictWitness && !queryWords.isEmpty()
            && hits.stream().noneMatch(hit -> BifrostLiteCompressor.hasExplicitConflict(hit.entry()))) {
            // This is a policy witness, not an extra prompt item. Only an already owner/filter/mode
            // eligible marker whose own text covers every query term may block from below the cutoff.
            Set<String> required = new HashSet<>(queryWords);
            for (SearchHit hit : remaining) {
                if (hit.lexicalScore() > 0 && BifrostLiteCompressor.hasExplicitConflict(hit.entry())
                    && new HashSet<>(tokens(hit.entry().getText())).containsAll(required)) {
                    witness = hit;
                    break;
                }
            }
            if (witness == null) ambiguous = WeekdaySettingAmbiguity.find(query, hits, remaining);
        }
        // A link never qualifies an otherwise unrelated memory. Reuse this independent ranking,
        // requiring body evidence rather than a match supplied solely by type/tags or hash buckets.
        Set<String> requiredWords = new HashSet<>(queryWords);
        List<SearchHit> anchors = associationRecall && !requiredWords.isEmpty()
            ? hits.stream().filter(hit -> new HashSet<>(tokens(hit.entry().getText())).containsAll(requiredWords))
                .limit(AssociationRecall.MAX_ANCHORS).toList() : List.of();
        List<SearchHit> neighbors = anchors.isEmpty() ? List.of() : remaining.stream()
            .filter(hit -> bm25(hit.entry().getText(), queryWords, documentFrequency, candidates.size(), averageLength) > 0)
            .toList();
        return new SearchResponse(List.copyOf(hits), mode,
            semanticActive ? embeddings.semanticProfile() : LocalMemoryEmbeddingService.HASH_PROFILE,
            semanticDegraded, witness, ambiguous, anchors, neighbors);
    }

    public static String sourceHash(MemoryEntry entry) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update("graymatter-lite/memory-source/v2\0".getBytes(StandardCharsets.UTF_8));
            for (String field : new String[]{entry.getType(), entry.getText(), entry.getTags(), entry.getSourceChannel()}) {
                byte[] bytes = field == null ? null : field.getBytes(StandardCharsets.UTF_8);
                digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes == null ? -1 : bytes.length).array());
                if (bytes != null) digest.update(bytes);
            }
            if (entry.getRevisionNonce() != null) {
                digest.update(ByteBuffer.allocate(2 * Long.BYTES)
                    .putLong(entry.getRevisionNonce().getMostSignificantBits())
                    .putLong(entry.getRevisionNonce().getLeastSignificantBits()).array());
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private Map<UUID, MemorySearchIndex> updateIndexes(List<MemoryEntry> entries, Map<UUID, MemorySearchIndex> existing,
                                                        boolean trySemantic) {
        Map<UUID, MemorySearchIndex> ready = new HashMap<>();
        List<PendingIndex> pending = new ArrayList<>();
        // Finish all model calls before acquiring any of the source-row write locks for this batch.
        for (MemoryEntry entry : entries) {
            MemorySearchIndex cached = existing.get(entry.getId());
            MemorySearchIndex projection = projection(entry, cached, trySemantic);
            if (projection == cached) ready.put(entry.getId(), cached);
            else pending.add(new PendingIndex(entry, projection));
        }
        pending.sort(Comparator.comparing(item -> item.entry().getId()));
        for (PendingIndex item : pending) {
            MemoryEntry entry = item.entry();
            if (memories.lockIndexRevision(entry.getId(), entry.getPrincipal().getId(), entry.getRevisionNonce()).isPresent()) {
                ready.put(entry.getId(), indexes.save(item.row()));
            }
        }
        return ready;
    }

    private record PendingIndex(MemoryEntry entry, MemorySearchIndex row) {}

    private MemorySearchIndex projection(MemoryEntry entry, MemorySearchIndex existing, boolean trySemantic) {
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
        return new MemorySearchIndex(entry, hash,
            LocalMemoryEmbeddingService.HASH_PROFILE,
            LocalMemoryEmbeddingService.encode(embeddings.featureHash(searchText(entry))),
            semantic == null ? null : profile,
            semantic == null ? null : LocalMemoryEmbeddingService.encode(semantic));
    }

    private Map<UUID, MemorySearchIndex> ownerIndexes(String username) {
        Map<UUID, MemorySearchIndex> result = new HashMap<>();
        indexes.findByPrincipalUsernameIgnoreCase(username).forEach(row -> result.put(row.getMemoryId(), row));
        return result;
    }

    private Map<UUID, MemorySearchIndex> candidateIndexes(String username, List<MemoryEntry> candidates) {
        Map<UUID, MemorySearchIndex> result = new HashMap<>();
        List<UUID> ids = candidates.stream().map(MemoryEntry::getId).toList();
        for (int start = 0; start < ids.size(); start += INDEX_ID_BATCH_SIZE) {
            List<UUID> batch = ids.subList(start, Math.min(start + INDEX_ID_BATCH_SIZE, ids.size()));
            indexes.findByPrincipalUsernameIgnoreCaseAndMemoryIdIn(username, batch)
                .forEach(row -> result.put(row.getMemoryId(), row));
        }
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
                                 boolean semanticDegraded, SearchHit conflictWitness, List<SearchHit> ambiguousWeekdayWitnesses,
                                 List<SearchHit> associationAnchors, List<SearchHit> associationCandidates) {
        public SearchResponse(List<SearchHit> hits, String retrievalMode, String vectorProfile,
                              boolean semanticDegraded, SearchHit conflictWitness, List<SearchHit> ambiguousWeekdayWitnesses) {
            this(hits, retrievalMode, vectorProfile, semanticDegraded, conflictWitness, ambiguousWeekdayWitnesses,
                List.of(), List.of());
        }
    }
    public record ReindexResult(int indexed, int semanticIndexed, int deletedStale,
                                String vectorProfile, boolean dryRun, int candidateCount) {}
    private record Scored(MemoryEntry entry, double lexical, double dense, String sourceHash) {}
}
