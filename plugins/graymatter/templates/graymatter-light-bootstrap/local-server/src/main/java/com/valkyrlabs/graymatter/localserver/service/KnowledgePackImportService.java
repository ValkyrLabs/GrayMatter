package com.valkyrlabs.graymatter.localserver.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.model.KnowledgePackRecord;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.KnowledgePackRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class KnowledgePackImportService {

    public static final String FORMAT = "graymatter.knowledge-pack";
    public static final String FORMAT_VERSION = "1.0";
    public static final int MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
    private static final long MAX_UNCOMPRESSED_BYTES = 128L * 1024L * 1024L;
    private static final int MAX_ARCHIVE_ENTRIES = 5000;
    private static final int MAX_JSONL_RECORDS = 5000;
    private static final int MAX_JSONL_LINE_CHARS = 4 * 1024 * 1024;
    private static final Set<String> REQUIRED_ENTRIES = Set.of(
        "manifest.json", "objects.jsonl", "edges.jsonl", "signature.json");
    private static final Set<String> FORBIDDEN_PORTABLE_FIELDS = Set.of(
        "ownerid", "owner", "principal", "principalid", "tenant", "tenantid", "organization",
        "organizationid", "acl", "acls", "permission", "permissions", "accesscontrollist");

    private final ObjectMapper objectMapper;
    private final PrincipalRecordRepository principals;
    private final KnowledgePackRepository knowledgePacks;
    private final MemoryEntryRepository memoryEntries;

    public KnowledgePackImportService(
        ObjectMapper objectMapper,
        PrincipalRecordRepository principals,
        KnowledgePackRepository knowledgePacks,
        MemoryEntryRepository memoryEntries) {
        this.objectMapper = objectMapper;
        this.principals = principals;
        this.knowledgePacks = knowledgePacks;
        this.memoryEntries = memoryEntries;
    }

    @Transactional
    public ImportResult importArchive(String username, byte[] archiveBytes) {
        requireArchiveSize(archiveBytes);
        PrincipalRecord owner = principals.findByUsernameIgnoreCase(username)
            .orElseThrow(() -> new IllegalArgumentException("Authenticated principal was not found"));
        Map<String, byte[]> entries = readArchive(archiveBytes);
        byte[] manifestBytes = requireEntry(entries, "manifest.json");
        byte[] objectsBytes = requireEntry(entries, "objects.jsonl");
        byte[] edgesBytes = requireEntry(entries, "edges.jsonl");
        byte[] signatureBytes = requireEntry(entries, "signature.json");

        JsonNode manifest = readObject(manifestBytes, "manifest.json");
        JsonNode signature = readObject(signatureBytes, "signature.json");
        validateManifest(manifest);
        verifySignature(manifestBytes, signature);
        verifyContentDigest(manifest, objectsBytes, edgesBytes, entries);

        List<JsonNode> objects = readJsonLines(objectsBytes, "objects.jsonl");
        List<JsonNode> edges = readJsonLines(edgesBytes, "edges.jsonl");
        validatePortableObjects(objects);
        objects.forEach(this::rejectAuthorityFields);
        edges.forEach(this::rejectAuthorityFields);
        validateCounts(manifest, objects, edges, entries);

        UUID sourcePackId = uuid(manifest, "packId");
        String contentDigest = requiredText(manifest, "contentDigest", 64);
        var existing = knowledgePacks.findByOwnerUsernameIgnoreCaseAndSourcePackIdAndContentDigest(
            username, sourcePackId, contentDigest);
        if (existing.isPresent()) {
            return result(existing.get(), true);
        }

        int memoryCount = Math.toIntExact(objects.stream()
            .filter(object -> "MemoryEntry".equals(object.path("kind").asText()))
            .count());
        KnowledgePackRecord pack = knowledgePacks.save(new KnowledgePackRecord(
            owner,
            sourcePackId,
            requiredText(manifest, "name", 255),
            requiredText(manifest, "formatVersion", 32),
            contentDigest,
            sha256(archiveBytes),
            optionalText(signature, "trustModel", "self-contained-v1", 64),
            optionalText(signature, "identityAssurance", "unverified", 128),
            objects.size(),
            edges.size(),
            blobEntries(entries).size(),
            memoryCount,
            utf8(manifestBytes),
            utf8(objectsBytes),
            utf8(edgesBytes),
            utf8(signatureBytes),
            archiveBytes));

        List<MemoryEntry> importedMemories = new ArrayList<>(memoryCount);
        for (JsonNode object : objects) {
            if (!"MemoryEntry".equals(object.path("kind").asText())) continue;
            String text = searchableExcerpt(requiredText(object, "text", 25_000_000));
            importedMemories.add(new MemoryEntry(
                owner,
                optionalText(object, "type", "context", 64),
                text,
                "knowledge-pack:" + pack.getId(),
                importedTags(object.path("tags")),
                pack,
                optionalText(object, "sourceId", null, 64)));
        }
        memoryEntries.saveAll(importedMemories);
        return result(pack, false);
    }

    @Transactional(readOnly = true)
    public List<KnowledgePackSummary> list(String username) {
        return knowledgePacks.findByOwnerUsernameIgnoreCaseOrderByImportedAtDesc(username)
            .stream()
            .map(view -> new KnowledgePackSummary(
                view.getId(), view.getSourcePackId(), view.getName(), view.getFormatVersion(),
                view.getContentDigest(), view.getArchiveSha256(), view.getTrustModel(),
                view.getIdentityAssurance(), view.getObjectCount(), view.getEdgeCount(),
                view.getBlobCount(), view.getMemoryEntryCount(), view.getImportedAt()))
            .toList();
    }

    @Transactional(readOnly = true)
    public KnowledgePackSummary detail(String username, UUID id) {
        return summary(owned(username, id));
    }

    @Transactional(readOnly = true)
    public KnowledgePackGraph graph(String username, UUID id) {
        KnowledgePackRecord pack = owned(username, id);
        return new KnowledgePackGraph(
            summary(pack),
            readJsonLines(pack.getObjectsJsonl().getBytes(StandardCharsets.UTF_8), "objects.jsonl"),
            readJsonLines(pack.getEdgesJsonl().getBytes(StandardCharsets.UTF_8), "edges.jsonl"));
    }

    @Transactional(readOnly = true)
    public byte[] archive(String username, UUID id) {
        return owned(username, id).getArchiveBytes();
    }

    private KnowledgePackRecord owned(String username, UUID id) {
        return knowledgePacks.findByIdAndOwnerUsernameIgnoreCase(id, username)
            .orElseThrow(() -> new KnowledgePackNotFoundException("KnowledgePack not found"));
    }

    private ImportResult result(KnowledgePackRecord pack, boolean alreadyImported) {
        return new ImportResult(summary(pack), alreadyImported, "INTEGRITY_VERIFIED");
    }

    private KnowledgePackSummary summary(KnowledgePackRecord pack) {
        return new KnowledgePackSummary(
            pack.getId(), pack.getSourcePackId(), pack.getName(), pack.getFormatVersion(),
            pack.getContentDigest(), pack.getArchiveSha256(), pack.getTrustModel(),
            pack.getIdentityAssurance(), pack.getObjectCount(), pack.getEdgeCount(),
            pack.getBlobCount(), pack.getMemoryEntryCount(), pack.getImportedAt());
    }

    private void requireArchiveSize(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            throw new KnowledgePackValidationException("KnowledgePack archive is empty");
        }
        if (bytes.length > MAX_ARCHIVE_BYTES) {
            throw new KnowledgePackValidationException("KnowledgePack archive exceeds 64 MiB");
        }
    }

    private String searchableExcerpt(String text) {
        if (text.length() <= 16_000) return text;
        return text.substring(0, 15_950) + "\n\n[Search excerpt truncated; full text remains in the KnowledgePack graph.]";
    }

    private Map<String, byte[]> readArchive(byte[] archive) {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        long totalBytes = 0L;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(archive), StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String path = entry.getName();
                validateArchivePath(path);
                if (entries.size() >= MAX_ARCHIVE_ENTRIES) {
                    throw new KnowledgePackValidationException("KnowledgePack has too many archive entries");
                }
                if (!REQUIRED_ENTRIES.contains(path) && !path.startsWith("blobs/")) {
                    throw new KnowledgePackValidationException("Unsupported KnowledgePack entry: " + path);
                }
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                while ((read = zip.read(buffer)) != -1) {
                    totalBytes += read;
                    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
                        throw new KnowledgePackValidationException("KnowledgePack exceeds 128 MiB uncompressed");
                    }
                    output.write(buffer, 0, read);
                }
                if (entries.putIfAbsent(path, output.toByteArray()) != null) {
                    throw new KnowledgePackValidationException("Duplicate KnowledgePack entry: " + path);
                }
                zip.closeEntry();
            }
        } catch (KnowledgePackValidationException error) {
            throw error;
        } catch (IOException error) {
            throw new KnowledgePackValidationException("KnowledgePack is not a readable ZIP archive", error);
        }
        for (String required : REQUIRED_ENTRIES) requireEntry(entries, required);
        return entries;
    }

    private void validateArchivePath(String path) {
        if (path == null || path.isBlank() || path.startsWith("/") || path.contains("\\")
            || List.of(path.split("/")).contains("..")) {
            throw new KnowledgePackValidationException("Unsafe KnowledgePack archive path");
        }
    }

    private byte[] requireEntry(Map<String, byte[]> entries, String path) {
        byte[] bytes = entries.get(path);
        if (bytes == null) throw new KnowledgePackValidationException("KnowledgePack is missing " + path);
        return bytes;
    }

    private JsonNode readObject(byte[] bytes, String source) {
        try {
            JsonNode node = objectMapper.readTree(bytes);
            if (node == null || !node.isObject()) {
                throw new KnowledgePackValidationException(source + " must contain a JSON object");
            }
            return node;
        } catch (KnowledgePackValidationException error) {
            throw error;
        } catch (IOException error) {
            throw new KnowledgePackValidationException(source + " is invalid JSON", error);
        }
    }

    private List<JsonNode> readJsonLines(byte[] bytes, String source) {
        List<JsonNode> result = new ArrayList<>();
        String[] lines = utf8(bytes).split("\\R", -1);
        for (String line : lines) {
            if (line.isBlank()) continue;
            if (line.length() > MAX_JSONL_LINE_CHARS) {
                throw new KnowledgePackValidationException(source + " contains an oversized record");
            }
            if (result.size() >= MAX_JSONL_RECORDS) {
                throw new KnowledgePackValidationException(source + " contains too many records");
            }
            result.add(readObject(line.getBytes(StandardCharsets.UTF_8), source));
        }
        return result;
    }

    private void validateManifest(JsonNode manifest) {
        if (!FORMAT.equals(requiredText(manifest, "format", 64))) {
            throw new KnowledgePackValidationException("Unsupported KnowledgePack format");
        }
        if (!FORMAT_VERSION.equals(requiredText(manifest, "formatVersion", 32))) {
            throw new KnowledgePackValidationException("Unsupported KnowledgePack format version");
        }
        if (!"SHA-256".equalsIgnoreCase(requiredText(manifest, "contentDigestAlgorithm", 32))) {
            throw new KnowledgePackValidationException("KnowledgePack must use SHA-256 content digests");
        }
        if (!"do-not-transplant".equals(requiredText(manifest, "aclImportPolicy", 64))) {
            throw new KnowledgePackValidationException("KnowledgePack ACL import policy is unsafe");
        }
        if (!"regenerate-on-import".equals(requiredText(manifest, "embeddingPolicy", 64))) {
            throw new KnowledgePackValidationException("KnowledgePack embedding policy is unsafe");
        }
        uuid(manifest, "packId");
        requiredText(manifest, "name", 255);
    }

    private void verifySignature(byte[] manifest, JsonNode signatureNode) {
        try {
            if (!"Ed25519".equals(requiredText(signatureNode, "algorithm", 32))
                || !"manifest.json".equals(requiredText(signatureNode, "signedEntry", 64))
                || !"X.509".equals(requiredText(signatureNode, "publicKeyFormat", 32))
                || !"self-contained-v1".equals(requiredText(signatureNode, "trustModel", 64))
                || !"unverified-until-publisher-trust-binding".equals(
                    requiredText(signatureNode, "identityAssurance", 128))) {
                throw new KnowledgePackValidationException("KnowledgePack signature contract is unsupported");
            }
            byte[] publicKeyBytes = Base64.getDecoder().decode(requiredText(signatureNode, "publicKey", 4096));
            byte[] signatureBytes = Base64.getDecoder().decode(requiredText(signatureNode, "signature", 4096));
            PublicKey publicKey = KeyFactory.getInstance("Ed25519")
                .generatePublic(new X509EncodedKeySpec(publicKeyBytes));
            Signature verifier = Signature.getInstance("Ed25519");
            verifier.initVerify(publicKey);
            verifier.update(manifest);
            if (!verifier.verify(signatureBytes)) {
                throw new KnowledgePackValidationException("KnowledgePack manifest signature is invalid");
            }
        } catch (KnowledgePackValidationException error) {
            throw error;
        } catch (Exception error) {
            throw new KnowledgePackValidationException("KnowledgePack signature cannot be verified", error);
        }
    }

    private void verifyContentDigest(
        JsonNode manifest,
        byte[] objects,
        byte[] edges,
        Map<String, byte[]> entries) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(objects);
            digest.update(edges);
            blobEntries(entries).stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
                digest.update(entry.getKey().getBytes(StandardCharsets.UTF_8));
                digest.update(entry.getValue());
            });
            String actual = HexFormat.of().formatHex(digest.digest());
            String expected = requiredText(manifest, "contentDigest", 64).toLowerCase(Locale.ROOT);
            if (!expected.matches("[0-9a-f]{64}")) {
                throw new KnowledgePackValidationException("KnowledgePack content digest is not SHA-256 hex");
            }
            if (!MessageDigest.isEqual(
                actual.getBytes(StandardCharsets.US_ASCII), expected.getBytes(StandardCharsets.US_ASCII))) {
                throw new KnowledgePackValidationException("KnowledgePack content digest does not match");
            }
        } catch (KnowledgePackValidationException error) {
            throw error;
        } catch (Exception error) {
            throw new KnowledgePackValidationException("KnowledgePack digest cannot be verified", error);
        }
    }

    private List<Map.Entry<String, byte[]>> blobEntries(Map<String, byte[]> entries) {
        return entries.entrySet().stream().filter(entry -> entry.getKey().startsWith("blobs/")).toList();
    }

    private void validateCounts(
        JsonNode manifest,
        List<JsonNode> objects,
        List<JsonNode> edges,
        Map<String, byte[]> entries) {
        JsonNode counts = manifest.path("counts");
        if (!counts.isObject()) throw new KnowledgePackValidationException("KnowledgePack counts are missing");
        int declaredObjects = boundedCount(counts, "memoryEntries") + boundedCount(counts, "contentData");
        if (declaredObjects != objects.size()
            || boundedCount(counts, "edges") != edges.size()
            || boundedCount(counts, "blobs") != blobEntries(entries).size()) {
            throw new KnowledgePackValidationException("KnowledgePack manifest counts do not match the archive");
        }
    }

    private int boundedCount(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.canConvertToInt() || value.asInt() < 0 || value.asInt() > MAX_JSONL_RECORDS) {
            throw new KnowledgePackValidationException("Invalid KnowledgePack count: " + field);
        }
        return value.asInt();
    }

    private void validatePortableObjects(List<JsonNode> objects) {
        for (JsonNode object : objects) {
            String kind = requiredText(object, "kind", 64);
            if (!"MemoryEntry".equals(kind) && !"ContentData".equals(kind)) {
                throw new KnowledgePackValidationException("Unsupported portable object kind: " + kind);
            }
        }
    }

    private void rejectAuthorityFields(JsonNode node) {
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                String normalized = field.getKey().replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
                if (FORBIDDEN_PORTABLE_FIELDS.contains(normalized)) {
                    throw new KnowledgePackValidationException(
                        "KnowledgePack attempts to transplant authority field: " + field.getKey());
                }
                rejectAuthorityFields(field.getValue());
            }
        } else if (node.isArray()) {
            node.forEach(this::rejectAuthorityFields);
        }
    }

    private String importedTags(JsonNode tags) {
        Set<String> values = new LinkedHashSet<>();
        values.add("knowledge-pack");
        if (tags.isArray()) {
            tags.forEach(tag -> {
                String value = tag.asText("").trim();
                if (!value.isBlank() && value.length() <= 80) values.add(value);
            });
        }
        String joined = String.join(",", values);
        return joined.length() <= 2048 ? joined : joined.substring(0, 2048);
    }

    private UUID uuid(JsonNode node, String field) {
        try {
            return UUID.fromString(requiredText(node, field, 64));
        } catch (IllegalArgumentException error) {
            throw new KnowledgePackValidationException("KnowledgePack field is not a UUID: " + field, error);
        }
    }

    private String requiredText(JsonNode node, String field, int maxLength) {
        String value = optionalText(node, field, null, maxLength);
        if (value == null) throw new KnowledgePackValidationException("KnowledgePack field is required: " + field);
        return value;
    }

    private String optionalText(JsonNode node, String field, String fallback, int maxLength) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || value.asText().isBlank()) return fallback;
        String text = value.asText().trim();
        if (text.length() > maxLength) {
            throw new KnowledgePackValidationException("KnowledgePack field is too long: " + field);
        }
        return text;
    }

    private static String utf8(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    public record ImportResult(
        KnowledgePackSummary knowledgePack,
        boolean alreadyImported,
        String integrityStatus) {
    }

    public record KnowledgePackSummary(
        UUID id,
        UUID sourcePackId,
        String name,
        String formatVersion,
        String contentDigest,
        String archiveSha256,
        String trustModel,
        String identityAssurance,
        int objectCount,
        int edgeCount,
        int blobCount,
        int memoryEntryCount,
        java.time.Instant importedAt) {
    }

    public record KnowledgePackGraph(
        KnowledgePackSummary knowledgePack,
        List<JsonNode> objects,
        List<JsonNode> edges) {
    }

    public static class KnowledgePackValidationException extends IllegalArgumentException {
        public KnowledgePackValidationException(String message) { super(message); }
        public KnowledgePackValidationException(String message, Throwable cause) { super(message, cause); }
    }

    public static class KnowledgePackNotFoundException extends IllegalArgumentException {
        public KnowledgePackNotFoundException(String message) { super(message); }
    }
}
