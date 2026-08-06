package com.valkyrlabs.graymatter.localserver.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.springframework.stereotype.Component;

/** Creates portable self-contained KnowledgePacks without exporting local authority fields. */
@Component
public class KnowledgePackArchiveWriter {

    private final ObjectMapper objectMapper;

    public KnowledgePackArchiveWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public byte[] write(UUID packId, String name, List<PortableMemory> memories) {
        try {
            byte[] objects = objectsJsonl(memories);
            byte[] edges = new byte[0];
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(objects);
            digest.update(edges);
            String contentDigest = HexFormat.of().formatHex(digest.digest());

            Map<String, Object> manifest = new LinkedHashMap<>();
            manifest.put("format", KnowledgePackImportService.FORMAT);
            manifest.put("formatVersion", KnowledgePackImportService.FORMAT_VERSION);
            manifest.put("packId", packId);
            manifest.put("name", name);
            manifest.put("contentDigestAlgorithm", "SHA-256");
            manifest.put("contentDigest", contentDigest);
            manifest.put("aclImportPolicy", "do-not-transplant");
            manifest.put("embeddingPolicy", "regenerate-on-import");
            manifest.put("counts", Map.of(
                "memoryEntries", memories.size(),
                "contentData", 0,
                "edges", 0,
                "blobs", 0,
                "redactions", 0));
            byte[] manifestBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(manifest);

            KeyPair keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
            Signature signer = Signature.getInstance("Ed25519");
            signer.initSign(keyPair.getPrivate());
            signer.update(manifestBytes);
            byte[] signatureBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(Map.of(
                "algorithm", "Ed25519",
                "signedEntry", "manifest.json",
                "publicKeyFormat", "X.509",
                "publicKey", Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded()),
                "signature", Base64.getEncoder().encodeToString(signer.sign()),
                "trustModel", "self-contained-v1",
                "identityAssurance", "unverified-until-publisher-trust-binding"));

            try (ByteArrayOutputStream output = new ByteArrayOutputStream();
                ZipOutputStream zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
                writeEntry(zip, "manifest.json", manifestBytes);
                writeEntry(zip, "objects.jsonl", objects);
                writeEntry(zip, "edges.jsonl", edges);
                writeEntry(zip, "signature.json", signatureBytes);
                zip.finish();
                return output.toByteArray();
            }
        } catch (Exception error) {
            throw new IllegalStateException("Unable to create GrayMatter KnowledgePack", error);
        }
    }

    private byte[] objectsJsonl(List<PortableMemory> memories) throws Exception {
        StringBuilder output = new StringBuilder();
        for (PortableMemory memory : memories) {
            Map<String, Object> portable = new LinkedHashMap<>();
            portable.put("kind", "MemoryEntry");
            portable.put("sourceId", memory.sourceId());
            portable.put("type", memory.type());
            portable.put("text", memory.text());
            portable.put("tags", memory.tags());
            output.append(objectMapper.writeValueAsString(portable)).append('\n');
        }
        return output.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static void writeEntry(ZipOutputStream zip, String path, byte[] bytes) throws Exception {
        ZipEntry entry = new ZipEntry(path);
        entry.setTime(0L);
        zip.putNextEntry(entry);
        zip.write(bytes);
        zip.closeEntry();
    }

    public record PortableMemory(UUID sourceId, String type, String text, List<String> tags) {
    }
}
