package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/** Bounded, deterministic context compiler over already owner-authorized memories. */
@Service
public class BifrostLiteCompressor {
    public static final String POLICY = "bifrost-lite-context/v1";
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
        List<Source> ordered = authorized.stream().sorted(Comparator
            .comparingInt((Source source) -> priority(source.entry(), protectedRefs)).reversed()
            .thenComparing(Comparator.comparingDouble(Source::score).reversed())
            .thenComparing(source -> source.entry().getId())).toList();
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
            String excerpt = excerpt(safe, query, Math.min(excerptBudget, 1200));
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

    private static int priority(MemoryEntry entry, Set<UUID> protectedRefs) {
        if (protectedRefs.contains(entry.getId())) return 5;
        String role = entry.getType().toLowerCase(Locale.ROOT) + " " + entry.getTags().toLowerCase(Locale.ROOT);
        if (role.contains("conflict") || role.contains("unresolved")) return 4;
        if (role.contains("decision") || role.contains("invariant")) return 3;
        if (role.contains("todo") || role.contains("transition")) return 2;
        return 1;
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

    private static String excerpt(String text, String query, int limit) {
        if (text.isBlank() || limit < 32) return "";
        if (utf8Bytes(text) <= limit) return text;
        int match = -1;
        Matcher matcher = TERM.matcher(query == null ? "" : query.toLowerCase(Locale.ROOT));
        String lower = text.toLowerCase(Locale.ROOT);
        while (matcher.find()) {
            int found = lower.indexOf(matcher.group());
            if (found >= 0 && (match < 0 || found < match)) match = found;
        }
        int contentLimit = Math.max(1, limit - 18);
        int start = match < 0 ? 0 : Math.max(0, match - contentLimit / 3);
        start = Math.min(start, Math.max(0, text.length() - contentLimit));
        int end = Math.min(text.length(), start + contentLimit);
        String prefix = start > 0 ? "...[earlier] " : "";
        String suffix = end < text.length() ? " ...[later]" : "";
        String result = prefix + text.substring(start, end).trim() + suffix;
        return utf8Prefix(result, limit);
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
