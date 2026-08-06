package com.valkyrlabs.graymatter.localserver.service;

import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class KnowledgePackExportService {

    private final MemoryEntryRepository memoryEntries;
    private final KnowledgePackArchiveWriter archiveWriter;

    public KnowledgePackExportService(
        MemoryEntryRepository memoryEntries,
        KnowledgePackArchiveWriter archiveWriter) {
        this.memoryEntries = memoryEntries;
        this.archiveWriter = archiveWriter;
    }

    @Transactional(readOnly = true)
    public ExportResult export(String username) {
        List<MemoryEntry> entries = memoryEntries.findByPrincipalUsernameIgnoreCaseOrderByCreatedAtAsc(username);
        List<KnowledgePackArchiveWriter.PortableMemory> portable = entries.stream()
            .map(entry -> new KnowledgePackArchiveWriter.PortableMemory(
                entry.getId(),
                entry.getType(),
                entry.getText(),
                tags(entry.getTags())))
            .toList();
        UUID packId = stablePackId(username, entries);
        return new ExportResult(
            "graymatter-lite-memory.gmkp",
            archiveWriter.write(packId, "GrayMatter Lite Memory Export", portable),
            entries.size());
    }

    private static List<String> tags(String tags) {
        if (tags == null || tags.isBlank()) return List.of();
        return Arrays.stream(tags.split(","))
            .map(String::trim)
            .filter(value -> !value.isBlank())
            .distinct()
            .toList();
    }

    private static UUID stablePackId(String username, List<MemoryEntry> entries) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(username.toLowerCase().getBytes(StandardCharsets.UTF_8));
            for (MemoryEntry entry : entries) {
                digest.update(entry.getId().toString().getBytes(StandardCharsets.US_ASCII));
                digest.update(entry.getModifiedAt().toString().getBytes(StandardCharsets.US_ASCII));
            }
            String hex = HexFormat.of().formatHex(digest.digest());
            return UUID.nameUUIDFromBytes(hex.getBytes(StandardCharsets.US_ASCII));
        } catch (Exception error) {
            throw new IllegalStateException("Unable to derive KnowledgePack export ID", error);
        }
    }

    public record ExportResult(String fileName, byte[] archive, int memoryEntryCount) {
    }
}
