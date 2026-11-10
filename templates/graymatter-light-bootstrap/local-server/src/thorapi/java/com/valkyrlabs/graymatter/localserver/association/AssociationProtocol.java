package com.valkyrlabs.graymatter.localserver.association;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class AssociationProtocol {
    static final String VERSION = "graymatter-memory-association/v1";
    static final Capability CAPABILITY = new Capability(VERSION, true, "record-identity-navigation",
        "sha256-length-prefixed-utf8/v1", true, 128, 512);
    private static final Pattern UUID_FORMAT = Pattern.compile("[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}");
    private static final Pattern WHITE_SPACE = Pattern.compile("\\p{IsWhite_Space}");
    private static final Set<String> FIELDS = Set.of("fromId", "toId", "relation");
    private static final ObjectMapper STRICT = new ObjectMapper()
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    record Capability(String contractVersion, boolean supported, String semantics, String tupleHashAlgorithm,
                      boolean cascadeDelete, int maxRelationCodePoints, int maxRelationUtf8Bytes) {}
    record Receipt(String contractVersion, String status, UUID associationRef, UUID fromId, UUID toId,
                   String relation, String tupleHash, OffsetDateTime recordedAt, boolean replayed) {}
    record Tuple(UUID fromId, UUID toId, String relation) {
        String hash() {
            return digest(VERSION, fromId.toString(), toId.toString(), relation);
        }
    }

    static Tuple parse(byte[] body) {
        JsonNode node;
        try {
            node = STRICT.readTree(body);
        } catch (java.io.IOException e) {
            throw badRequest();
        }
        if (node == null || !node.isObject() || node.size() != FIELDS.size()
            || !FIELDS.stream().allMatch(key -> node.path(key).isTextual())) throw badRequest();
        UUID from = uuid(node.get("fromId").textValue());
        UUID to = uuid(node.get("toId").textValue());
        String relation = node.get("relation").textValue();
        if (from.equals(to) || !validRelation(relation)) throw badRequest();
        return new Tuple(from, to, relation);
    }

    static UUID uuid(String text) {
        if (!UUID_FORMAT.matcher(text).matches()) throw badRequest();
        return UUID.fromString(text);
    }

    static boolean validRelation(String relation) {
        int points = relation.codePointCount(0, relation.length());
        if (points == 0 || points > CAPABILITY.maxRelationCodePoints()) return false;
        if (WHITE_SPACE.matcher(relation.substring(0, Character.charCount(relation.codePointAt(0)))).matches()
            || WHITE_SPACE.matcher(relation.substring(relation.offsetByCodePoints(relation.length(), -1))).matches()) return false;
        if (relation.codePoints().anyMatch(cp -> Character.isISOControl(cp) || cp >= 0xd800 && cp <= 0xdfff)) return false;
        return relation.getBytes(StandardCharsets.UTF_8).length <= CAPABILITY.maxRelationUtf8Bytes();
    }

    static String digest(String... fields) {
        try {
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            for (String field : fields) {
                byte[] bytes = field.getBytes(StandardCharsets.UTF_8);
                hash.update(ByteBuffer.allocate(4).putInt(bytes.length).array());
                hash.update(bytes);
            }
            return HexFormat.of().formatHex(hash.digest());
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException(unavailable);
        }
    }

    private static ResponseStatusException badRequest() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid memory association");
    }

    private AssociationProtocol() {}
}
