package com.valkyrlabs.graymatter.localserver.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt;
import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt.RetrievalStatus;
import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt.SourceRef;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemoryRetrievalReceiptRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Receipt-backed Bifrost subset for the single-principal Lite memory graph. */
@Service
public class MemoryContextService {
    private final PrincipalRecordRepository principals;
    private final MemoryEntryRepository memories;
    private final MemoryRetrievalReceiptRepository receipts;
    private final MemoryHybridSearchService search;
    private final BifrostLiteCompressor compressor;
    private AssociationRecall associationRecall;

    public MemoryContextService(PrincipalRecordRepository principals, MemoryEntryRepository memories,
                                MemoryRetrievalReceiptRepository receipts, MemoryHybridSearchService search,
                                BifrostLiteCompressor compressor) {
        this.principals = principals;
        this.memories = memories;
        this.receipts = receipts;
        this.search = search;
        this.compressor = compressor;
    }

    @Autowired(required = false)
    public void setAssociationRecall(AssociationRecall associationRecall) {
        this.associationRecall = associationRecall;
    }

    @Transactional(isolation = Isolation.SERIALIZABLE)
    public ContextResponse compile(String username, ContextRequest request, boolean includeText) {
        return discover(username, request, includeText, null);
    }

    @Transactional(isolation = Isolation.SERIALIZABLE)
    public ContextResponse refresh(String username, UUID parentId, ContextRequest request) {
        MemoryRetrievalReceipt parent = ownedReceipt(username, parentId);
        if (parent.getDiscoveryScopeHash() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Original search scope unavailable; compile a new context");
        }
        return discover(username, request, request != null && !Boolean.FALSE.equals(request.includeText()), parent);
    }

    private ContextResponse discover(String username, ContextRequest request, boolean includeText,
                                     MemoryRetrievalReceipt parent) {
        validate(request);
        if (request.evictedRefs() != null && !request.evictedRefs().isEmpty()) {
            throw badRequest("Eviction requires an existing receipt");
        }
        int topK = request.topK() == null ? 8 : request.topK();
        int budget = request.tokenBudget() == null ? 4000 : request.tokenBudget();
        MemorySearchFilterParser.Filters filters;
        try {
            filters = MemorySearchFilterParser.merge(request.type(), request.source(),
                request.tags(), request.filters());
        } catch (IllegalArgumentException ex) {
            throw badRequest(ex.getMessage());
        }
        String scope = discoveryScope(request, filters, topK, budget);
        if (parent != null && !scope.equals(parent.getDiscoveryScopeHash())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Refresh must use the original query, filters and selection settings");
        }
        MemoryHybridSearchService.SearchResponse matches;
        boolean expandAssociations = Boolean.TRUE.equals(request.includeAssociations());
        if (expandAssociations && associationRecall == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Association recall requires the generated persistent store");
        }
        try {
            var searchRequest = new MemoryHybridSearchService.SearchRequest(
                request.query(), topK, request.retrievalMode(),
                filters.type(), filters.source(), filters.tags());
            matches = expandAssociations ? search.searchForAssociationContext(username, searchRequest)
                : search.searchForContext(username, searchRequest);
        } catch (IllegalArgumentException ex) {
            throw badRequest(ex.getMessage());
        }
        AssociationRecall.Expansion expansion = expandAssociations
            ? associationRecall.discover(username, matches.associationAnchors(), matches.associationCandidates()) : null;
        List<MemoryHybridSearchService.SearchHit> selected = new ArrayList<>(matches.hits());
        if (expansion != null) selected.addAll(expansion.neighbors());
        List<BifrostLiteCompressor.Source> sources = selected.stream()
            .map(hit -> new BifrostLiteCompressor.Source(hit.entry(), hit.sourceHash(), hit.score()))
            .toList();
        Set<UUID> protectedRefs = checkedRefs(request.protectedRefs(), sources);
        BifrostLiteCompressor.ContextResult context = compress(sources, request.query(), budget, protectedRefs);
        PrincipalRecord principal = principals.findByUsernameIgnoreCase(username).orElseThrow();
        List<SourceRef> pointers = new ArrayList<>(sources.size() + 1);
        Set<UUID> ambiguous = new HashSet<>();
        matches.ambiguousWeekdayWitnesses().forEach(hit -> ambiguous.add(hit.entry().getId()));
        for (var source : sources) {
            var entry = source.entry();
            pointers.add(new SourceRef(entry.getId(), source.sourceHash(), BifrostLiteCompressor.hasExplicitConflict(entry),
                ambiguous.remove(entry.getId())));
        }
        for (var hit : matches.ambiguousWeekdayWitnesses()) {
            if (ambiguous.contains(hit.entry().getId())) pointers.add(new SourceRef(hit.entry().getId(), hit.sourceHash(), false, true));
        }
        if (matches.conflictWitness() != null) {
            var witness = matches.conflictWitness();
            if (pointers.stream().noneMatch(ref -> ref.getMemoryId().equals(witness.entry().getId())))
                pointers.add(new SourceRef(witness.entry().getId(), witness.sourceHash(), true, false));
        }
        RetrievalStatus status = evaluate(context, pointers, List.of(), matches.semanticDegraded(),
            expansion != null && expansion.truncated());
        MemoryRetrievalReceipt receipt = new MemoryRetrievalReceipt(principal,
            BifrostLiteCompressor.sha256(request.query().trim()), matches.retrievalMode(), budget,
            expandAssociations ? AssociationRecall.POLICY : BifrostLiteCompressor.POLICY, status, matches.semanticDegraded(), false,
            parent == null ? null : parent.getId(), pointers, protectedRefs);
        if (expansion != null) receipt.bindAssociations(expansion.anchors(), expansion.stateHash(), expansion.truncated(), expansion.refs());
        receipt.bindDiscoveryScope(scope);
        String selectors = ReceiptCandidateState.selectors(filters);
        receipt.bindCandidateState(selectors, ReceiptCandidateState.fingerprint(memories, principal.getId(), selectors));
        receipt = receipts.save(receipt);
        return response(receipt, context, matches.vectorProfile(), List.of(), includeText);
    }

    // Hash structured values so different queries, sources or tag sets cannot share a lineage
    // through concatenation. Receipts keep neither the query nor the source/tag strings.
    private static String discoveryScope(ContextRequest request, MemorySearchFilterParser.Filters filters,
                                         int topK, int budget) {
        var scope = JsonNodeFactory.instance.arrayNode();
        scope.add("lite-search-scope/v1").add(request.query().trim()).add(topK).add(budget);
        String mode = request.retrievalMode();
        scope.add(mode == null || mode.isBlank() ? "HYBRID" : mode.toUpperCase(Locale.ROOT));
        scope.add(Objects.toString(filters.type(), "")).add(Objects.toString(filters.source(), ""));
        var tags = scope.addArray();
        filters.tags().stream().map(tag -> tag.trim().toLowerCase(Locale.ROOT)).distinct().sorted().forEach(tags::add);
        var protectedIds = scope.addArray();
        if (request.protectedRefs() != null) {
            request.protectedRefs().stream().distinct().sorted().forEach(id -> protectedIds.add(id.toString()));
        }
        // Preserve the exact historic hash for ordinary receipts and refresh requests.
        if (Boolean.TRUE.equals(request.includeAssociations())) scope.add(AssociationRecall.POLICY);
        return BifrostLiteCompressor.sha256(scope.toString());
    }

    @Transactional(readOnly = true, isolation = Isolation.SERIALIZABLE)
    public ReceiptStatus receipt(String username, UUID id) {
        MemoryRetrievalReceipt receipt = ownedReceipt(username, id);
        List<UUID> stale = staleRefs(receipt, ownedSources(username, receipt));
        RetrievalStatus recorded = receipt.getRecordedRetrievalStatus();
        RetrievalStatus current = currentStatus(receipt, stale);
        return new ReceiptStatus(receipt.getId(), receipt.getParentReceiptId(), receipt.getPolicyVersion(),
            receipt.getRetrievalMode(), receipt.getQueryHash(), receipt.getTokenBudget(),
            receipt.getCreatedAt(), receipt.getSources().size(),
            receipt.getProtectedRefs().stream().sorted().toList(), stale,
            recorded, current, current.answerPolicy, current.recommendedAction, receipt.conflictRefs(), receipt.ambiguousRefs(),
            receipt.isSourceSetNarrowed(), receipt.getSourceSelection(),
            current == RetrievalStatus.STALE_CONTEXT || current == RetrievalStatus.RETRY_REQUIRED ? List.of() : receipt.getAssociationRefs(),
            receipt.isAssociationTruncated(), associationPolicy(receipt));
    }

    private Map<UUID, MemoryEntry> ownedSources(String username, MemoryRetrievalReceipt receipt) {
        List<UUID> ids = receipt.getSources().stream().map(SourceRef::getMemoryId).toList();
        if (ids.isEmpty()) return Map.of();
        Map<UUID, MemoryEntry> owned = new HashMap<>();
        for (MemoryEntry entry : memories.findByPrincipalUsernameIgnoreCaseAndIdIn(username, ids)) {
            owned.put(entry.getId(), entry);
        }
        return owned;
    }

    private static List<UUID> staleRefs(MemoryRetrievalReceipt receipt, Map<UUID, MemoryEntry> owned) {
        List<UUID> stale = new ArrayList<>();
        for (MemoryRetrievalReceipt.SourceRef ref : receipt.getSources()) {
            MemoryEntry entry = owned.get(ref.getMemoryId());
            if (entry == null || sourceChanged(receipt, ref, entry)) {
                stale.add(ref.getMemoryId());
            }
        }
        return List.copyOf(stale);
    }

    private static boolean sourceChanged(MemoryRetrievalReceipt receipt, SourceRef ref, MemoryEntry entry) {
        // The v1 fingerprint joined fields with newlines. It remains readable, but only current receipts
        // with a recorded positive decision can hydrate or produce another prompt.
        String hash = "bifrost-lite-context/v1".equals(receipt.getPolicyVersion())
            ? BifrostLiteCompressor.sha256(entry.getType() + "\n" + entry.getText() + "\n"
                + entry.getTags() + "\n" + entry.getSourceChannel())
            : MemoryHybridSearchService.sourceHash(entry);
        return !ref.getSourceHash().equals(hash);
    }

    private RetrievalStatus currentStatus(MemoryRetrievalReceipt receipt, List<UUID> stale) {
        if (!stale.isEmpty()) return RetrievalStatus.STALE_CONTEXT;
        if (!hasCurrentPolicy(receipt)) return RetrievalStatus.RETRY_REQUIRED;
        return candidateStateChanged(receipt) || associationStateChanged(receipt)
            ? RetrievalStatus.STALE_CONTEXT : receipt.getRecordedRetrievalStatus();
    }

    private boolean candidateStateChanged(MemoryRetrievalReceipt receipt) {
        String current = ReceiptCandidateState.fingerprint(memories, receipt.getPrincipal().getId(), receipt.getCandidateSelectors());
        return !current.equals(receipt.getCandidateStateHash());
    }

    private boolean hasCurrentPolicy(MemoryRetrievalReceipt receipt) {
        return (BifrostLiteCompressor.POLICY.equals(receipt.getPolicyVersion())
                && receipt.getAssociationAnchors() == null && receipt.getAssociationRefs().isEmpty()
            || AssociationRecall.POLICY.equals(receipt.getPolicyVersion()) && associationRecall != null)
            && receipt.getRecordedRetrievalStatus() != null
            && ReceiptCandidateState.hasProof(receipt.getCandidateSelectors(), receipt.getCandidateStateHash());
    }

    private boolean associationStateChanged(MemoryRetrievalReceipt receipt) {
        return AssociationRecall.POLICY.equals(receipt.getPolicyVersion())
            && !associationRecall.current(receipt.getPrincipal().getUsername(), receipt);
    }

    @Transactional(readOnly = true, isolation = Isolation.SERIALIZABLE)
    public HydrationResponse hydrate(String username, UUID receiptId, UUID memoryId, int maxTokens) {
        MemoryRetrievalReceipt receipt = ownedReceipt(username, receiptId);
        MemoryRetrievalReceipt.SourceRef pointer = receipt.getSources().stream()
            .filter(ref -> ref.getMemoryId().equals(memoryId)).findFirst()
            .orElseThrow(() -> notFound());
        Map<UUID, MemoryEntry> owned = ownedSources(username, receipt);
        MemoryEntry entry = owned.get(memoryId);
        if (entry == null) throw notFound();
        if (currentStatus(receipt, staleRefs(receipt, owned)) != RetrievalStatus.OK) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Receipt policy blocks hydration; retrieve fresh context");
        }
        try {
            var excerpt = compressor.hydrate(entry, maxTokens);
            return new HydrationResponse(receiptId, memoryId, pointer.getSourceHash(), excerpt.text(),
                excerpt.text().getBytes(StandardCharsets.UTF_8).length, excerpt.truncated());
        } catch (IllegalArgumentException ex) {
            throw badRequest(ex.getMessage());
        }
    }

    @Transactional(isolation = Isolation.SERIALIZABLE)
    public ContextResponse recompress(String username, UUID receiptId, ContextRequest request,
                                      boolean includeText) {
        validate(request);
        if (request.filters() != null || request.type() != null || request.source() != null
            || request.tags() != null || request.topK() != null || request.retrievalMode() != null
            || request.includeAssociations() != null) {
            throw badRequest("Recompression uses the receipt's fixed source set");
        }
        MemoryRetrievalReceipt parent = ownedReceipt(username, receiptId);
        if (!parent.getQueryHash().equals(BifrostLiteCompressor.sha256(request.query().trim()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Query does not match receipt");
        }
        if (!hasCurrentPolicy(parent)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Original receipt policy unavailable; retrieve fresh context");
        }
        Set<UUID> known = new HashSet<>();
        parent.getSources().forEach(ref -> known.add(ref.getMemoryId()));
        Set<UUID> evicted = request.evictedRefs() == null ? Set.of() : Set.copyOf(request.evictedRefs());
        if (!evicted.isEmpty() && parent.getAssociationAnchors() != null) {
            Set<UUID> dependencies = new HashSet<>();
            if (!parent.getAssociationAnchors().isEmpty()) {
                try {
                    java.util.Arrays.stream(parent.getAssociationAnchors().split(",")).map(UUID::fromString).forEach(dependencies::add);
                } catch (IllegalArgumentException malformed) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "Association provenance unavailable; retrieve fresh context");
                }
            }
            parent.getAssociationRefs().forEach(ref -> dependencies.add(ref.getMemoryId()));
            if (!java.util.Collections.disjoint(evicted, dependencies))
                throw badRequest("Association provenance cannot be evicted; compile a new context");
        }
        if (!evicted.isEmpty() && parent.getRecordedRetrievalStatus() != RetrievalStatus.OK) {
            throw badRequest("A withheld receipt must retain all sources");
        }
        Set<UUID> protectedRefs = new HashSet<>(parent.getProtectedRefs());
        if (request.protectedRefs() != null) protectedRefs.addAll(request.protectedRefs());
        if (!known.containsAll(evicted) || !known.containsAll(protectedRefs)
            || !java.util.Collections.disjoint(evicted, protectedRefs)
            || !java.util.Collections.disjoint(evicted, parent.conflictRefs())) {
            throw badRequest("Retained or evicted refs are invalid for this receipt");
        }
        List<UUID> stale = new ArrayList<>();
        Map<UUID, MemoryEntry> owned = ownedSources(username, parent);
        List<SourceRef> pointers = new ArrayList<>();
        List<BifrostLiteCompressor.Source> sources = new ArrayList<>();
        int rank = 0;
        for (MemoryRetrievalReceipt.SourceRef ref : parent.getSources()) {
            rank++;
            MemoryEntry entry = owned.get(ref.getMemoryId());
            boolean changed = entry == null || sourceChanged(parent, ref, entry);
            if (!changed && evicted.contains(ref.getMemoryId())) continue;
            // Keep stale pointers on descendants even when their content can no longer be included.
            pointers.add(new SourceRef(ref.getMemoryId(), ref.getSourceHash(), ref.hasConflict(), ref.hasAmbiguousWeekday()));
            if (changed) {
                stale.add(ref.getMemoryId());
                continue;
            }
            sources.add(new BifrostLiteCompressor.Source(entry, ref.getSourceHash(), 1.0 / rank));
        }
        boolean cohortChanged = candidateStateChanged(parent) || associationStateChanged(parent);
        if ((!stale.isEmpty() || cohortChanged) && !evicted.isEmpty()) {
            throw badRequest("A stale receipt must retain all sources");
        }
        if (!java.util.Collections.disjoint(stale, protectedRefs)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Protected memory changed; retrieve fresh context");
        }
        int budget = request.tokenBudget() == null ? parent.getTokenBudget() : request.tokenBudget();
        BifrostLiteCompressor.ContextResult context = compress(sources, request.query(), budget, protectedRefs);
        boolean narrowed = parent.isSourceSetNarrowed() || !evicted.isEmpty();
        RetrievalStatus status = cohortChanged || parent.getRecordedRetrievalStatus() == RetrievalStatus.STALE_CONTEXT
            ? RetrievalStatus.STALE_CONTEXT : evaluate(context, pointers, stale, parent.isSemanticDegraded(),
                narrowed || parent.isAssociationTruncated());
        MemoryRetrievalReceipt child = new MemoryRetrievalReceipt(parent.getPrincipal(),
            parent.getQueryHash(), parent.getRetrievalMode(), budget, parent.getPolicyVersion(), status,
            parent.isSemanticDegraded(), narrowed, parent.getId(), pointers, protectedRefs);
        child.bindCandidateState(parent.getCandidateSelectors(), parent.getCandidateStateHash());
        if (parent.getAssociationAnchors() != null) {
            List<UUID> anchors = parent.getAssociationAnchors().isEmpty() ? List.of()
                : java.util.Arrays.stream(parent.getAssociationAnchors().split(",")).map(UUID::fromString).toList();
            child.bindAssociations(anchors, parent.getAssociationStateHash(), parent.isAssociationTruncated(), parent.getAssociationRefs());
        }
        child = receipts.save(child);
        return response(child, context, "rechecked-parent-sources", stale, includeText);
    }

    private BifrostLiteCompressor.ContextResult compress(List<BifrostLiteCompressor.Source> sources,
                                                          String query, int budget, Set<UUID> protectedRefs) {
        try {
            return compressor.compress(sources, query, budget, protectedRefs);
        } catch (IllegalArgumentException ex) {
            throw badRequest(ex.getMessage());
        }
    }

    private MemoryRetrievalReceipt ownedReceipt(String username, UUID id) {
        return receipts.findByIdAndPrincipalUsernameIgnoreCase(id, username)
            .orElseThrow(MemoryContextService::notFound);
    }

    private static void validate(ContextRequest request) {
        if (request == null || request.query() == null || request.query().isBlank()) {
            throw badRequest("query is required");
        }
        validateRefs(request.protectedRefs());
        validateRefs(request.evictedRefs());
        if (request.topK() != null && (request.topK() < 1 || request.topK() > 100)) {
            throw badRequest("topK must be between 1 and 100");
        }
        if (request.tokenBudget() != null && (request.tokenBudget() < 128 || request.tokenBudget() > 16000)) {
            throw badRequest("tokenBudget must be between 128 and 16000");
        }
    }

    private static void validateRefs(List<UUID> refs) {
        if (refs != null && (refs.size() > 100 || refs.stream().anyMatch(Objects::isNull))) {
            throw badRequest("Expected at most 100 memory IDs per reference list");
        }
    }

    private static Set<UUID> checkedRefs(List<UUID> requested, List<BifrostLiteCompressor.Source> sources) {
        Set<UUID> refs = requested == null ? Set.of() : Set.copyOf(requested);
        Set<UUID> found = new HashSet<>();
        sources.forEach(source -> found.add(source.entry().getId()));
        if (!found.containsAll(refs)) throw badRequest("Protected refs must be in authorized search results");
        return refs;
    }

    private static RetrievalStatus evaluate(BifrostLiteCompressor.ContextResult context, List<SourceRef> sources,
                                            List<UUID> stale, boolean semanticDegraded, boolean narrowed) {
        if (!stale.isEmpty()) return RetrievalStatus.STALE_CONTEXT;
        if (sources.stream().anyMatch(SourceRef::hasConflict)) return RetrievalStatus.CONFLICTING_CONTEXT;
        if (sources.stream().anyMatch(SourceRef::hasAmbiguousWeekday)) return RetrievalStatus.AMBIGUOUS_WEEKDAY;
        if (sources.isEmpty()) return RetrievalStatus.NO_RESULTS;
        if (narrowed || semanticDegraded || !context.omittedRefs().isEmpty() || !context.truncatedRefs().isEmpty()) {
            return RetrievalStatus.PARTIAL_COVERAGE;
        }
        return RetrievalStatus.OK;
    }

    private static ContextResponse response(MemoryRetrievalReceipt receipt,
                                            BifrostLiteCompressor.ContextResult context,
                                            String vectorProfile, List<UUID> stale, boolean includeText) {
        RetrievalStatus status = receipt.getRecordedRetrievalStatus();
        boolean allowed = status == RetrievalStatus.OK;
        List<BifrostLiteCompressor.ContextItem> items = allowed ? context.items() : List.of();
        if (allowed && !includeText) {
            items = items.stream().map(item -> new BifrostLiteCompressor.ContextItem(item.memoryId(),
                item.sourceHash(), item.type(), item.sourceChannel(), "", item.truncated(), item.score())).toList();
        }
        return new ContextResponse(receipt.getId(), allowed ? receipt.getId() : null, receipt.getParentReceiptId(),
            receipt.getPolicyVersion(), status,
            status.answerPolicy, status.recommendedAction,
            receipt.getRetrievalMode(), vectorProfile, receipt.isSemanticDegraded(),
            allowed && includeText ? context.context() : null, items,
            context.omittedRefs(), context.truncatedRefs(), List.copyOf(stale),
            allowed ? context.tokenEstimate() : 0, allowed ? context.contextHash() : null,
            receipt.getSources().size(), receipt.conflictRefs(), receipt.ambiguousRefs(), receipt.isSourceSetNarrowed(), receipt.getSourceSelection(),
            status == RetrievalStatus.STALE_CONTEXT || status == RetrievalStatus.RETRY_REQUIRED ? List.of() : receipt.getAssociationRefs(),
            receipt.isAssociationTruncated(), associationPolicy(receipt));
    }

    private static String associationPolicy(MemoryRetrievalReceipt receipt) {
        return AssociationRecall.POLICY.equals(receipt.getPolicyVersion()) ? "graymatter-association-recall/v1" : null;
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Retrieval receipt or memory not found");
    }

    public record ContextRequest(String query, Integer topK, Integer tokenBudget, String retrievalMode,
                                 String type, String source, List<String> tags,
                                 List<UUID> protectedRefs, List<UUID> evictedRefs,
                                 Boolean includeText, JsonNode filters, Boolean includeAssociations) {
        public ContextRequest(String query, Integer topK, Integer tokenBudget, String retrievalMode,
                              String type, String source, List<String> tags, List<UUID> protectedRefs,
                              List<UUID> evictedRefs, Boolean includeText, JsonNode filters) {
            this(query, topK, tokenBudget, retrievalMode, type, source, tags, protectedRefs, evictedRefs, includeText, filters, null);
        }
    }
    public record ContextResponse(UUID receiptId, UUID contextPageRef, UUID parentReceiptId,
                                  String policyVersion,
                                  RetrievalStatus retrievalStatus, String answerPolicy, String recommendedAction,
                                  String retrievalMode, String vectorProfile, boolean semanticDegraded,
                                  String context, List<BifrostLiteCompressor.ContextItem> items,
                                  List<UUID> omittedRefs, List<UUID> truncatedRefs,
                                  List<UUID> staleRefs, int tokenEstimate, String contextHash,
                                  int sourceCount, List<UUID> conflictRefs, List<UUID> ambiguousRefs, boolean sourceSetNarrowed, String sourceSelection,
                                  List<MemoryRetrievalReceipt.AssociationRef> associationRefs, boolean associationTruncated,
                                  @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
                                  String associationPolicyVersion) {}
    public record ReceiptStatus(UUID receiptId, UUID parentReceiptId, String policyVersion,
                                String retrievalMode, String queryHash, int tokenBudget,
                                java.time.Instant createdAt, int sourceCount,
                                List<UUID> protectedRefs, List<UUID> staleRefs,
                                RetrievalStatus recordedRetrievalStatus, RetrievalStatus retrievalStatus,
                                String answerPolicy, String recommendedAction, List<UUID> conflictRefs, List<UUID> ambiguousRefs,
                                boolean sourceSetNarrowed, String sourceSelection,
                                List<MemoryRetrievalReceipt.AssociationRef> associationRefs, boolean associationTruncated,
                                  @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
                                  String associationPolicyVersion) {}
    public record HydrationResponse(UUID receiptId, UUID memoryId, String sourceHash,
                                    String excerpt, int tokenEstimate, boolean truncated) {}
}
