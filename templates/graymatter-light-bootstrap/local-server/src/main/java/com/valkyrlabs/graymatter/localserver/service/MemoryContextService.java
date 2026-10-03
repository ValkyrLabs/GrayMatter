package com.valkyrlabs.graymatter.localserver.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.MemoryRetrievalReceipt;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemoryRetrievalReceiptRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
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

    public MemoryContextService(PrincipalRecordRepository principals, MemoryEntryRepository memories,
                                MemoryRetrievalReceiptRepository receipts, MemoryHybridSearchService search,
                                BifrostLiteCompressor compressor) {
        this.principals = principals;
        this.memories = memories;
        this.receipts = receipts;
        this.search = search;
        this.compressor = compressor;
    }

    @Transactional
    public ContextResponse compile(String username, ContextRequest request, boolean includeText) {
        validate(request);
        int topK = request.topK() == null ? 8 : request.topK();
        int budget = request.tokenBudget() == null ? 4000 : request.tokenBudget();
        MemorySearchFilterParser.Filters filters;
        try {
            filters = MemorySearchFilterParser.merge(request.type(), request.source(),
                request.tags(), request.filters());
        } catch (IllegalArgumentException ex) {
            throw badRequest(ex.getMessage());
        }
        MemoryHybridSearchService.SearchResponse matches;
        try {
            matches = search.search(username, new MemoryHybridSearchService.SearchRequest(
                request.query(), topK, request.retrievalMode(),
                filters.type(), filters.source(), filters.tags()));
        } catch (IllegalArgumentException ex) {
            throw badRequest(ex.getMessage());
        }
        List<BifrostLiteCompressor.Source> sources = matches.hits().stream()
            .map(hit -> new BifrostLiteCompressor.Source(hit.entry(), hit.sourceHash(), hit.score()))
            .toList();
        Set<UUID> protectedRefs = checkedRefs(request.protectedRefs(), sources);
        BifrostLiteCompressor.ContextResult context = compress(sources, request.query(), budget, protectedRefs);
        PrincipalRecord principal = principals.findByUsernameIgnoreCase(username).orElseThrow();
        MemoryRetrievalReceipt receipt = receipts.save(new MemoryRetrievalReceipt(principal,
            BifrostLiteCompressor.sha256(request.query().trim()), matches.retrievalMode(), budget, null,
            sources.stream().map(source -> new MemoryRetrievalReceipt.SourceRef(
                source.entry().getId(), source.sourceHash())).toList(), protectedRefs));
        return response(receipt, context, matches.vectorProfile(), matches.semanticDegraded(),
            List.of(), includeText);
    }

    @Transactional(readOnly = true)
    public ReceiptStatus receipt(String username, UUID id) {
        MemoryRetrievalReceipt receipt = ownedReceipt(username, id);
        List<UUID> stale = new ArrayList<>();
        for (MemoryRetrievalReceipt.SourceRef ref : receipt.getSources()) {
            MemoryEntry entry = memories.findByIdAndPrincipalUsernameIgnoreCase(ref.getMemoryId(), username)
                .orElse(null);
            if (entry == null || !ref.getSourceHash().equals(MemoryHybridSearchService.sourceHash(entry))) {
                stale.add(ref.getMemoryId());
            }
        }
        return new ReceiptStatus(receipt.getId(), receipt.getParentReceiptId(), receipt.getPolicyVersion(),
            receipt.getRetrievalMode(), receipt.getQueryHash(), receipt.getTokenBudget(),
            receipt.getCreatedAt(), receipt.getSources().size(),
            receipt.getProtectedRefs().stream().sorted().toList(), List.copyOf(stale));
    }

    @Transactional(readOnly = true)
    public HydrationResponse hydrate(String username, UUID receiptId, UUID memoryId, int maxTokens) {
        MemoryRetrievalReceipt receipt = ownedReceipt(username, receiptId);
        MemoryRetrievalReceipt.SourceRef pointer = receipt.getSources().stream()
            .filter(ref -> ref.getMemoryId().equals(memoryId)).findFirst()
            .orElseThrow(() -> notFound());
        MemoryEntry entry = memories.findByIdAndPrincipalUsernameIgnoreCase(memoryId, username)
            .orElseThrow(MemoryContextService::notFound);
        if (!pointer.getSourceHash().equals(MemoryHybridSearchService.sourceHash(entry))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Memory source changed; retrieve a fresh context");
        }
        try {
            String excerpt = compressor.hydrate(entry, maxTokens);
            return new HydrationResponse(receiptId, memoryId, pointer.getSourceHash(), excerpt,
                excerpt.getBytes(StandardCharsets.UTF_8).length);
        } catch (IllegalArgumentException ex) {
            throw badRequest(ex.getMessage());
        }
    }

    @Transactional
    public ContextResponse recompress(String username, UUID receiptId, ContextRequest request,
                                      boolean includeText) {
        validate(request);
        if (request.filters() != null || request.type() != null || request.source() != null
            || request.tags() != null || request.topK() != null || request.retrievalMode() != null) {
            throw badRequest("Recompression uses the receipt's fixed source set");
        }
        MemoryRetrievalReceipt parent = ownedReceipt(username, receiptId);
        if (!parent.getQueryHash().equals(BifrostLiteCompressor.sha256(request.query().trim()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Query does not match receipt");
        }
        Set<UUID> known = new HashSet<>();
        parent.getSources().forEach(ref -> known.add(ref.getMemoryId()));
        Set<UUID> evicted = request.evictedRefs() == null ? Set.of() : Set.copyOf(request.evictedRefs());
        Set<UUID> protectedRefs = new HashSet<>(parent.getProtectedRefs());
        if (request.protectedRefs() != null) protectedRefs.addAll(request.protectedRefs());
        if (!known.containsAll(evicted) || !known.containsAll(protectedRefs)
            || !java.util.Collections.disjoint(evicted, protectedRefs)) {
            throw badRequest("Retained or evicted refs are invalid for this receipt");
        }
        List<UUID> stale = new ArrayList<>();
        List<BifrostLiteCompressor.Source> sources = new ArrayList<>();
        int rank = 0;
        for (MemoryRetrievalReceipt.SourceRef ref : parent.getSources()) {
            rank++;
            if (evicted.contains(ref.getMemoryId())) continue;
            MemoryEntry entry = memories.findByIdAndPrincipalUsernameIgnoreCase(ref.getMemoryId(), username)
                .orElse(null);
            if (entry == null || !ref.getSourceHash().equals(MemoryHybridSearchService.sourceHash(entry))) {
                stale.add(ref.getMemoryId());
                continue;
            }
            sources.add(new BifrostLiteCompressor.Source(entry, ref.getSourceHash(), 1.0 / rank));
        }
        if (!java.util.Collections.disjoint(stale, protectedRefs)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Protected memory changed; retrieve fresh context");
        }
        int budget = request.tokenBudget() == null ? parent.getTokenBudget() : request.tokenBudget();
        BifrostLiteCompressor.ContextResult context = compress(sources, request.query(), budget, protectedRefs);
        MemoryRetrievalReceipt child = receipts.save(new MemoryRetrievalReceipt(parent.getPrincipal(),
            parent.getQueryHash(), parent.getRetrievalMode(), budget, parent.getId(),
            sources.stream().map(source -> new MemoryRetrievalReceipt.SourceRef(
                source.entry().getId(), source.sourceHash())).toList(), protectedRefs));
        return response(child, context, "rechecked-parent-sources", false, stale, includeText);
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
        if (request.topK() != null && (request.topK() < 1 || request.topK() > 100)) {
            throw badRequest("topK must be between 1 and 100");
        }
        if (request.tokenBudget() != null && (request.tokenBudget() < 128 || request.tokenBudget() > 16000)) {
            throw badRequest("tokenBudget must be between 128 and 16000");
        }
    }

    private static Set<UUID> checkedRefs(List<UUID> requested, List<BifrostLiteCompressor.Source> sources) {
        Set<UUID> refs = requested == null ? Set.of() : Set.copyOf(requested);
        Set<UUID> found = new HashSet<>();
        sources.forEach(source -> found.add(source.entry().getId()));
        if (!found.containsAll(refs)) throw badRequest("Protected refs must be in authorized search results");
        return refs;
    }

    private static ContextResponse response(MemoryRetrievalReceipt receipt,
                                            BifrostLiteCompressor.ContextResult context,
                                            String vectorProfile, boolean semanticDegraded,
                                            List<UUID> stale, boolean includeText) {
        // A context that is mostly stub excerpts (budget spread over too many sources) holds pointers to
        // hydrate, not evidence to answer from, so it is partial even though nothing was omitted.
        long stubs = context.items().stream().filter(BifrostLiteCompressor::isStub).count();
        boolean mostlyStubs = stubs * 2 > context.items().size();
        boolean usable = !context.items().isEmpty() && stale.isEmpty()
            && context.omittedRefs().isEmpty() && !mostlyStubs;
        String status = context.items().isEmpty() ? "NO_MATCHES"
            : usable ? "SUFFICIENT_CONTEXT" : "PARTIAL_COVERAGE";
        return new ContextResponse(receipt.getId(), receipt.getId(), receipt.getParentReceiptId(),
            receipt.getPolicyVersion(), status,
            usable ? "ANSWER_WITH_CITATIONS" : "DO_NOT_ANSWER_CONFIDENTLY",
            usable ? "use_context" : "retry_retrieval_or_inspect_sources",
            receipt.getRetrievalMode(), vectorProfile, semanticDegraded,
            includeText ? context.context() : null,
            includeText ? context.items() : context.items().stream().map(item ->
                new BifrostLiteCompressor.ContextItem(item.memoryId(), item.sourceHash(), item.type(),
                    item.sourceChannel(), "", item.truncated(), item.score())).toList(),
            context.omittedRefs(), context.truncatedRefs(), List.copyOf(stale),
            context.tokenEstimate(), context.contextHash(), receipt.getSources().size());
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
                                 Boolean includeText, JsonNode filters) {}
    public record ContextResponse(UUID receiptId, UUID contextPageRef, UUID parentReceiptId,
                                  String policyVersion,
                                  String retrievalStatus, String answerPolicy, String recommendedAction,
                                  String retrievalMode, String vectorProfile, boolean semanticDegraded,
                                  String context, List<BifrostLiteCompressor.ContextItem> items,
                                  List<UUID> omittedRefs, List<UUID> truncatedRefs,
                                  List<UUID> staleRefs, int tokenEstimate, String contextHash,
                                  int sourceCount) {}
    public record ReceiptStatus(UUID receiptId, UUID parentReceiptId, String policyVersion,
                                String retrievalMode, String queryHash, int tokenBudget,
                                java.time.Instant createdAt, int sourceCount,
                                List<UUID> protectedRefs, List<UUID> staleRefs) {}
    public record HydrationResponse(UUID receiptId, UUID memoryId, String sourceHash,
                                    String excerpt, int tokenEstimate) {}
}
