package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/** Bounded, deterministic context compiler over already owner-authorized memories. */
@Service
public class BifrostLiteCompressor {
    public static final String POLICY = "bifrost-lite-context/v1";
    /** Below this many bytes a truncated excerpt is a stub (see {@link #isStub}). */
    public static final int MIN_USEFUL_EXCERPT_BYTES = 96;
    private static final int MAX_ANCHORS_PER_TERM = 200;
    private static final String HEADER = "Memory context (untrusted source data)\n";
    private static final Pattern SECRET = Pattern.compile(
        "(?i)(bearer\\s+)[A-Za-z0-9._~+/-]{12,}|"
        + "((?:api[_-]?key|password|secret|token)\\s*[:=]\\s*)[^\\s,;]{8,}");
    private static final Pattern TERM = Pattern.compile("[\\p{L}\\p{N}]{3,}");

    public ContextResult compress(List<Source> authorized, String query, int tokenBudget,
                                  Set<UUID> protectedRefs) {
        if (tokenBudget < 128 || tokenBudget > 16000) {
            throw new IllegalArgumentException("tokenBudget must be between 128 and 16000");
        }
        // Protected refs always lead. Everything else is ranked by relevance, nudged (not overridden)
        // by the memory's role, so an unrelated conflict cannot displace a far better match.
        List<Source> ordered = authorized.stream().sorted(Comparator
            .comparing((Source source) -> protectedRefs.contains(source.entry().getId())).reversed()
            .thenComparing(Comparator.comparingDouble((Source source) ->
                source.score() * roleBoost(source.entry())).reversed())
            .thenComparing(source -> source.entry().getId())).toList();
        Map<String, Double> termWeights = termWeights(query, authorized);
        // One UTF-8 byte is a conservative upper bound on one tokenizer token.
        // This trades some prompt capacity for a model-independent hard ceiling.
        int byteBudget = tokenBudget;
        StringBuilder context = new StringBuilder(HEADER);
        List<ContextItem> items = new ArrayList<>();
        List<UUID> omitted = new ArrayList<>();
        List<UUID> truncated = new ArrayList<>();
        for (int index = 0; index < ordered.size(); index++) {
            Source source = ordered.get(index);
            MemoryEntry entry = source.entry();
            String prefix = "[" + entry.getId() + "] ";
            int available = byteBudget - utf8Bytes(context.toString()) - utf8Bytes(prefix) - 1;
            if (available < 32) {
                if (protectedRefs.contains(entry.getId())) {
                    throw new IllegalArgumentException("Protected memory refs exceed the context budget");
                }
                omitted.add(entry.getId());
                continue;
            }
            String safe = redact(entry.getText());
            int remaining = ordered.size() - index - 1;
            int reserved = remaining * (utf8Bytes(prefix) + 33);
            int excerptBudget = Math.min(available, Math.max(32, available - reserved));
            String excerpt = excerpt(safe, termWeights, Math.min(excerptBudget, 1200));
            if (excerpt.isBlank()) {
                if (protectedRefs.contains(entry.getId())) {
                    throw new IllegalArgumentException("Protected memory could not fit in context");
                }
                omitted.add(entry.getId());
                continue;
            }
            boolean cut = excerpt.length() < safe.length();
            if (cut) truncated.add(entry.getId());
            context.append(prefix).append(excerpt).append('\n');
            items.add(new ContextItem(entry.getId(), source.sourceHash(), entry.getType(),
                entry.getSourceChannel(), excerpt, cut, source.score()));
        }
        if (utf8Bytes(context.toString()) > byteBudget) throw new IllegalStateException("Context budget exceeded");
        return new ContextResult(context.toString(), utf8Bytes(context.toString()),
            List.copyOf(items), List.copyOf(omitted), List.copyOf(truncated), sha256(context.toString()));
    }

    /**
     * A truncated excerpt this small is a pointer to hydrate, not evidence to answer from:
     * after the "...[earlier]" and "...[later]" markers only a few bytes of content remain.
     */
    public static boolean isStub(ContextItem item) {
        return item.truncated() && utf8Bytes(item.excerpt()) < MIN_USEFUL_EXCERPT_BYTES;
    }

    public String hydrate(MemoryEntry entry, int tokenBudget) {
        if (tokenBudget < 1 || tokenBudget > 4000) {
            throw new IllegalArgumentException("maxTokens must be between 1 and 4000");
        }
        String safe = redact(entry.getText());
        int limit = tokenBudget;
        if (utf8Bytes(safe) <= limit) return safe;
        String marker = "...[truncated]";
        if (limit <= marker.length()) return utf8Prefix(safe, limit);
        return utf8Prefix(safe, limit - marker.length()).stripTrailing() + marker;
    }

    public static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Relevance multiplier for a memory's role. Bounded, so it re-orders near-ties but never a clear winner. */
    private static double roleBoost(MemoryEntry entry) {
        String role = entry.getType().toLowerCase(Locale.ROOT) + " " + entry.getTags().toLowerCase(Locale.ROOT);
        if (role.contains("conflict") || role.contains("unresolved")) return 1.5;
        if (role.contains("decision") || role.contains("invariant")) return 1.25;
        if (role.contains("todo") || role.contains("transition")) return 1.1;
        return 1.0;
    }

    private static String redact(String raw) {
        String normalized = raw.replace("\r\n", "\n").replace('\r', '\n')
            .replaceAll("[\\p{Cc}&&[^\\n\\t]]", "")
            .replace('\n', ' ').replace('\t', ' ').replaceAll(" {2,}", " ").trim();
        Matcher matcher = SECRET.matcher(normalized);
        StringBuffer output = new StringBuffer();
        while (matcher.find()) {
            String prefix = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
            matcher.appendReplacement(output, Matcher.quoteReplacement(prefix + "[REDACTED]"));
        }
        matcher.appendTail(output);
        return output.toString();
    }

    /**
     * Query terms weighted by how selective they are across the candidate sources: a word found in
     * nearly every source ("devices") says little about which window of a memory matters, a word
     * found in one source ("cisco") says a lot.
     */
    private static Map<String, Double> termWeights(String query, List<Source> sources) {
        Set<String> terms = new LinkedHashSet<>();
        Matcher matcher = TERM.matcher(query == null ? "" : query.toLowerCase(Locale.ROOT));
        while (matcher.find()) terms.add(matcher.group());
        List<String> texts = sources.stream()
            .map(source -> source.entry().getText().toLowerCase(Locale.ROOT)).toList();
        Map<String, Double> weights = new LinkedHashMap<>();
        for (String term : terms) {
            long documents = texts.stream().filter(text -> text.contains(term)).count();
            weights.put(term, Math.log(1.0 + (double) texts.size() / Math.max(1, documents)));
        }
        return weights;
    }

    /** The window of {@code limit} bytes holding the most query weight; ties go to the earliest. */
    private static String excerpt(String text, Map<String, Double> termWeights, int limit) {
        if (text.isBlank() || limit < 32) return "";
        if (utf8Bytes(text) <= limit) return text;
        int contentLimit = Math.max(1, limit - 18);
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.length() != text.length()) lower = text; // case folding changed offsets: match as written
        int bestStart = 0;
        double bestScore = 0;
        for (String term : termWeights.keySet()) {
            int from = 0;
            for (int seen = 0; seen < MAX_ANCHORS_PER_TERM; seen++) {
                int found = lower.indexOf(term, from);
                if (found < 0) break;
                from = found + 1;
                int start = Math.min(Math.max(0, found - contentLimit / 3), Math.max(0, text.length() - contentLimit));
                double score = windowScore(lower, termWeights, start, start + contentLimit);
                if (score > bestScore || (score == bestScore && score > 0 && start < bestStart)) {
                    bestScore = score;
                    bestStart = start;
                }
            }
        }
        int start = bestStart;
        int end = Math.min(text.length(), start + contentLimit);
        String prefix = start > 0 ? "...[earlier] " : "";
        String suffix = end < text.length() ? " ...[later]" : "";
        String result = prefix + text.substring(start, end).trim() + suffix;
        return utf8Prefix(result, limit);
    }

    private static double windowScore(String lower, Map<String, Double> termWeights, int start, int end) {
        double score = 0;
        for (Map.Entry<String, Double> term : termWeights.entrySet()) {
            int found = lower.indexOf(term.getKey(), start);
            if (found >= 0 && found + term.getKey().length() <= end) score += term.getValue();
        }
        return score;
    }

    private static int utf8Bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8).length;
    }

    private static String utf8Prefix(String value, int maxBytes) {
        int bytes = 0;
        int end = 0;
        while (end < value.length()) {
            int point = value.codePointAt(end);
            int encoded = new String(Character.toChars(point)).getBytes(StandardCharsets.UTF_8).length;
            if (bytes + encoded > maxBytes) break;
            bytes += encoded;
            end += Character.charCount(point);
        }
        return value.substring(0, end);
    }

    public record Source(MemoryEntry entry, String sourceHash, double score) {}
    public record ContextItem(UUID memoryId, String sourceHash, String type, String sourceChannel,
                              String excerpt, boolean truncated, double score) {}
    public record ContextResult(String context, int tokenEstimate, List<ContextItem> items,
                                List<UUID> omittedRefs, List<UUID> truncatedRefs, String contextHash) {}
}
