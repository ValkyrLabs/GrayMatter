package com.valkyrlabs.graymatter.localserver.bootstrap;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackArchiveWriter;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
@Order(20)
public class StarterKnowledgePackBootstrap implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(StarterKnowledgePackBootstrap.class);

    private final ObjectMapper objectMapper;
    private final PrincipalRecordRepository principals;
    private final KnowledgePackArchiveWriter archiveWriter;
    private final KnowledgePackImportService importer;
    private final String username;
    private final boolean enabled;

    public StarterKnowledgePackBootstrap(
        ObjectMapper objectMapper,
        PrincipalRecordRepository principals,
        KnowledgePackArchiveWriter archiveWriter,
        KnowledgePackImportService importer,
        @Value("${graymatter.admin.username}") String username,
        @Value("${graymatter.starter-knowledge-pack.enabled:true}") boolean enabled) {
        this.objectMapper = objectMapper;
        this.principals = principals;
        this.archiveWriter = archiveWriter;
        this.importer = importer;
        this.username = username;
        this.enabled = enabled;
    }

    @Override
    public void run(String... args) throws Exception {
        if (!enabled) return;
        if (principals.findByUsernameIgnoreCase(username).isEmpty()) {
            throw new IllegalStateException("Starter KnowledgePack cannot load before the Lite principal exists");
        }
        JsonNode pack;
        try (InputStream input = new ClassPathResource("knowledgepacks/graymatter-lite-starter.json")
            .getInputStream()) {
            pack = objectMapper.readTree(input);
        }
        List<KnowledgePackArchiveWriter.PortableMemory> memories = new ArrayList<>();
        for (JsonNode memory : pack.path("memories")) {
            List<String> tags = new ArrayList<>();
            memory.path("tags").forEach(tag -> tags.add(tag.asText()));
            memories.add(new KnowledgePackArchiveWriter.PortableMemory(
                UUID.fromString(memory.path("sourceId").asText()),
                memory.path("type").asText("context"),
                memory.path("text").asText(),
                tags));
        }
        byte[] archive = archiveWriter.write(
            UUID.fromString(pack.path("packId").asText()),
            pack.path("name").asText("GrayMatter Lite Starter KnowledgePack"),
            memories);
        KnowledgePackImportService.ImportResult result = importer.importArchive(username, archive);
        log.info("GrayMatter Lite starter KnowledgePack ready: {} memories, existing={}",
            result.knowledgePack().memoryEntryCount(), result.alreadyImported());
    }
}
