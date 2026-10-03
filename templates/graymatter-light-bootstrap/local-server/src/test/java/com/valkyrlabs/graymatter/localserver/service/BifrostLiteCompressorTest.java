package com.valkyrlabs.graymatter.localserver.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Receipt defects measured on 2026-10-02 against the live store, query "cisco devices":
 * excerpts centred on the generic word, an unrelated "conflict"-tagged finding ranked first,
 * and a context made mostly of stub excerpts still reported as sufficient.
 */
class BifrostLiteCompressorTest {
    private final BifrostLiteCompressor compressor = new BifrostLiteCompressor();
    private final PrincipalRecord owner = new PrincipalRecord("admin", "x", "Admin", "ROLE_USER");

    @Test
    void excerptCentresOnTheDiscriminatingTermNotAGenericOne() {
        String filler = "unrelated background filler ".repeat(110);
        List<BifrostLiteCompressor.Source> sources = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            sources.add(source("decision", "", "devices are common here " + i, 0.02));
        }
        // "devices" sits at the very start; "Cisco" is far later. Only "Cisco" is specific to this entry.
        MemoryEntry target = entry("decision", "", "devices overview. " + filler
            + "Cisco CIVS-IPC-8020-S run succeeded on the real device. " + filler);
        sources.add(new BifrostLiteCompressor.Source(target, "hash", 0.03));

        BifrostLiteCompressor.ContextResult result = compressor.compress(
            sources, "cisco devices", 4000, Set.of());

        BifrostLiteCompressor.ContextItem item = result.items().stream()
            .filter(candidate -> candidate.memoryId().equals(target.getId())).findFirst().orElseThrow();
        assertThat(item.truncated()).isTrue();
        assertThat(item.excerpt()).contains("Cisco CIVS-IPC-8020-S");
    }

    @Test
    void excerptPrefersAWindowHoldingMoreOfTheQueryWhenTermsAreEquallyRare() {
        String filler = "x".repeat(2000) + " ";
        MemoryEntry target = entry("decision", "", "alpha only early. " + filler
            + "alpha and beta together here. " + filler);

        BifrostLiteCompressor.ContextResult result = compressor.compress(
            List.of(new BifrostLiteCompressor.Source(target, "hash", 1.0)), "alpha beta", 4000, Set.of());

        assertThat(result.items().get(0).excerpt()).contains("alpha and beta together");
    }

    @Test
    void anIrrelevantConflictDoesNotOutrankAMuchMoreRelevantDecision() {
        BifrostLiteCompressor.Source conflict = source("decision", "doc-device-conflict", "Hanwha conflict", 0.0143);
        BifrostLiteCompressor.Source relevant = source("decision", "invariant", "Cisco result", 0.0297);

        BifrostLiteCompressor.ContextResult result = compressor.compress(
            List.of(conflict, relevant), "cisco", 4000, Set.of());

        assertThat(result.items()).extracting(BifrostLiteCompressor.ContextItem::memoryId)
            .containsExactly(relevant.entry().getId(), conflict.entry().getId());
    }

    @Test
    void aConflictStillWinsWhenItIsAboutAsRelevant() {
        BifrostLiteCompressor.Source conflict = source("decision", "unresolved-conflict", "open conflict", 0.0300);
        BifrostLiteCompressor.Source relevant = source("decision", "invariant", "settled decision", 0.0297);

        BifrostLiteCompressor.ContextResult result = compressor.compress(
            List.of(relevant, conflict), "conflict", 4000, Set.of());

        assertThat(result.items().get(0).memoryId()).isEqualTo(conflict.entry().getId());
    }

    @Test
    void protectedRefsStillComeFirstWhateverTheirScore() {
        BifrostLiteCompressor.Source strong = source("decision", "invariant", "strong match", 0.9);
        BifrostLiteCompressor.Source pinned = source("note", "", "pinned note", 0.001);

        BifrostLiteCompressor.ContextResult result = compressor.compress(
            List.of(strong, pinned), "match", 4000, Set.of(pinned.entry().getId()));

        assertThat(result.items().get(0).memoryId()).isEqualTo(pinned.entry().getId());
    }

    @Test
    void stubExcerptsAreRecognisedByTheirSizeAndTruncation() {
        UUID id = UUID.randomUUID();
        BifrostLiteCompressor.ContextItem stub = new BifrostLiteCompressor.ContextItem(
            id, "h", "decision", "c", "...[earlier] ms\" devices 1 ...[l", true, 0.1);
        BifrostLiteCompressor.ContextItem useful = new BifrostLiteCompressor.ContextItem(
            id, "h", "decision", "c", "x".repeat(300), true, 0.1);
        BifrostLiteCompressor.ContextItem whole = new BifrostLiteCompressor.ContextItem(
            id, "h", "decision", "c", "short but complete", false, 0.1);

        assertThat(BifrostLiteCompressor.isStub(stub)).isTrue();
        assertThat(BifrostLiteCompressor.isStub(useful)).isFalse();
        assertThat(BifrostLiteCompressor.isStub(whole)).isFalse();
    }

    private BifrostLiteCompressor.Source source(String type, String tags, String text, double score) {
        return new BifrostLiteCompressor.Source(entry(type, tags, text), "hash-" + UUID.randomUUID(), score);
    }

    private MemoryEntry entry(String type, String tags, String text) {
        MemoryEntry entry = new MemoryEntry(owner, type, text, "test", tags);
        ReflectionTestUtils.setField(entry, "id", UUID.randomUUID());
        return entry;
    }
}
