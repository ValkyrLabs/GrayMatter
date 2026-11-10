package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Content-free evidence of the owner-visible candidate set before text ranking or top-K. */
final class ReceiptCandidateState {
    private static final String ANY = "*";
    private static final String HASH = "[0-9a-f]{64}";
    private static final String OPTIONAL_HASH = "(?:\\*|" + HASH + ")";
    private static final Pattern SELECTORS = Pattern.compile(OPTIONAL_HASH + "\\|" + OPTIONAL_HASH
        + "\\|(?:\\*|" + HASH + "(?:," + HASH + "){0,49})");
    private static final Pattern FINGERPRINT = Pattern.compile(HASH);

    private ReceiptCandidateState() {}

    static boolean hasProof(String selectors, String fingerprint) {
        return selectors != null && fingerprint != null && SELECTORS.matcher(selectors).matches()
            && FINGERPRINT.matcher(fingerprint).matches();
    }

    static String selectors(MemorySearchFilterParser.Filters filters) {
        String tags = filters.tags().stream().map(ReceiptCandidateState::tagHash).distinct().sorted()
            .collect(Collectors.joining(","));
        return fieldHash(filters.type(), "type") + "|" + fieldHash(filters.source(), "source") + "|"
            + (tags.isEmpty() ? ANY : tags);
    }

    static String fingerprint(MemoryEntryRepository memories, UUID ownerId, String selectors) {
        String[] fields = selectors.split("[|]", -1);
        Set<String> tags = ANY.equals(fields[2]) ? Set.of() : Set.copyOf(Arrays.asList(fields[2].split(",")));
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable", error);
        }
        digest.update("graymatter-lite/receipt-candidate-state/v1\0".getBytes(StandardCharsets.UTF_8));
        ByteBuffer ids = ByteBuffer.allocate(33);
        try (var rows = memories.streamCandidateRevisions(ownerId)) {
            rows.forEachOrdered(row -> {
                if (!ANY.equals(fields[0]) && !fields[0].equals(fieldHash(row.getType(), "type"))) return;
                if (!ANY.equals(fields[1]) && !fields[1].equals(fieldHash(row.getSourceChannel(), "source"))) return;
                if (!tags.isEmpty()) {
                    Set<String> available = Arrays.stream(row.getTags().split(",")).map(ReceiptCandidateState::tagHash)
                        .collect(Collectors.toSet());
                    if (!available.containsAll(tags)) return;
                }
                ids.clear();
                UUID id = row.getId(), revision = row.getRevisionNonce();
                ids.putLong(id.getMostSignificantBits()).putLong(id.getLeastSignificantBits());
                ids.put((byte) (revision == null ? 0 : 1));
                if (revision != null) ids.putLong(revision.getMostSignificantBits()).putLong(revision.getLeastSignificantBits());
                digest.update(ids.flip());
            });
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static String fieldHash(String value, String field) {
        if (value == null || value.isBlank()) return ANY;
        // Match String.equalsIgnoreCase in the search filter, including Turkish I and Greek final sigma.
        StringBuilder folded = new StringBuilder(value.length());
        value.codePoints().map(cp -> Character.toLowerCase(Character.toUpperCase(cp))).forEach(folded::appendCodePoint);
        return BifrostLiteCompressor.sha256(field + "\0" + folded);
    }

    private static String tagHash(String tag) {
        return BifrostLiteCompressor.sha256("tag\0" + tag.trim().toLowerCase(Locale.ROOT));
    }
}
