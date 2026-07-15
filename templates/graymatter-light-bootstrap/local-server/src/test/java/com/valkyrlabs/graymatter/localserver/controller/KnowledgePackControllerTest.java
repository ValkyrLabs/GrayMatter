package com.valkyrlabs.graymatter.localserver.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.KnowledgePackRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:knowledge-pack-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop"
})
@AutoConfigureMockMvc
class KnowledgePackControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private KnowledgePackRepository knowledgePacks;

    @Autowired
    private MemoryEntryRepository memoryEntries;

    @Autowired
    private PrincipalRecordRepository principals;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @BeforeEach
    void resetOwnedData() {
        memoryEntries.deleteAll();
        knowledgePacks.deleteAll();
        if (principals.findByUsernameIgnoreCase("reader").isEmpty()) {
            principals.save(new PrincipalRecord(
                "reader", passwordEncoder.encode("reader-password"), "Reader", "ROLE_USER"));
        }
    }

    @Test
    void importsSignedPackIdempotentlyIndexesMemoryAndEnforcesOwnerIsolation() throws Exception {
        byte[] archive = archive(false, false, false);
        MockMultipartFile file = new MockMultipartFile(
            "file", "portable-agent-memory.gmkp",
            "application/vnd.valkyrlabs.graymatter-knowledge-pack+zip", archive);

        String body = mockMvc.perform(multipart("/v1/knowledge-packs/import")
                .file(file)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.integrityStatus").value("INTEGRITY_VERIFIED"))
            .andExpect(jsonPath("$.alreadyImported").value(false))
            .andExpect(jsonPath("$.knowledgePack.memoryEntryCount").value(1))
            .andReturn().getResponse().getContentAsString();
        UUID localPackId = UUID.fromString(objectMapper.readTree(body).path("knowledgePack").path("id").asText());

        mockMvc.perform(get("/v1/MemoryEntry").param("q", "portable")
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].text").value("Portable agent memory"))
            .andExpect(jsonPath("$[0].sourceChannel").value("knowledge-pack:" + localPackId));

        mockMvc.perform(get("/v1/knowledge-packs/{id}/graph", localPackId)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.objects[0].kind").value("MemoryEntry"))
            .andExpect(jsonPath("$.edges[0].relation").value("project"));

        mockMvc.perform(multipart("/v1/knowledge-packs/import")
                .file(file)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.alreadyImported").value(true));

        assertThat(knowledgePacks.count()).isEqualTo(1);
        assertThat(memoryEntries.count()).isEqualTo(1);

        mockMvc.perform(get("/v1/knowledge-packs/{id}", localPackId)
                .with(httpBasic("reader", "reader-password")))
            .andExpect(status().isNotFound());
    }

    @Test
    void rejectsUnauthenticatedAndAuthorityBearingArchives() throws Exception {
        MockMultipartFile valid = new MockMultipartFile(
            "file", "valid.gmkp", "application/zip", archive(false, false, false));
        mockMvc.perform(multipart("/v1/knowledge-packs/import").file(valid))
            .andExpect(status().isUnauthorized());

        MockMultipartFile unsafe = new MockMultipartFile(
            "file", "unsafe.gmkp", "application/zip", archive(true, false, false));
        mockMvc.perform(multipart("/v1/knowledge-packs/import")
                .file(unsafe)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("INVALID_KNOWLEDGE_PACK"));
    }

    @Test
    void rejectsTamperedManifestAndContent() throws Exception {
        MockMultipartFile manifestTamper = new MockMultipartFile(
            "file", "manifest-tamper.gmkp", "application/zip", archive(false, true, false));
        mockMvc.perform(multipart("/v1/knowledge-packs/import")
                .file(manifestTamper)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("KnowledgePack manifest signature is invalid"));

        MockMultipartFile contentTamper = new MockMultipartFile(
            "file", "content-tamper.gmkp", "application/zip", archive(false, false, true));
        mockMvc.perform(multipart("/v1/knowledge-packs/import")
                .file(contentTamper)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("KnowledgePack content digest does not match"));

        MockMultipartFile spoofedIdentity = new MockMultipartFile(
            "file", "identity-spoof.gmkp", "application/zip", archive(false, false, false, true));
        mockMvc.perform(multipart("/v1/knowledge-packs/import")
                .file(spoofedIdentity)
                .with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.message").value("KnowledgePack signature contract is unsupported"));
    }

    private byte[] archive(boolean includeOwnerId, boolean tamperManifest, boolean tamperContent) throws Exception {
        return archive(includeOwnerId, tamperManifest, tamperContent, false);
    }

    private byte[] archive(
        boolean includeOwnerId,
        boolean tamperManifest,
        boolean tamperContent,
        boolean spoofIdentityAssurance) throws Exception {
        UUID packId = UUID.randomUUID();
        Map<String, Object> object = new LinkedHashMap<>();
        object.put("kind", "MemoryEntry");
        object.put("sourceId", UUID.randomUUID());
        object.put("type", "decision");
        object.put("text", "Portable agent memory");
        object.put("tags", List.of("portable", "agent-memory"));
        if (includeOwnerId) object.put("ownerId", UUID.randomUUID());

        Map<String, Object> edge = Map.of(
            "sourceKind", "MemoryEntry",
            "sourceId", object.get("sourceId"),
            "relation", "project",
            "targetKind", "Project",
            "targetId", UUID.randomUUID(),
            "external", true);
        byte[] objects = (objectMapper.writeValueAsString(object) + "\n").getBytes(StandardCharsets.UTF_8);
        byte[] edges = (objectMapper.writeValueAsString(edge) + "\n").getBytes(StandardCharsets.UTF_8);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        digest.update(objects);
        digest.update(edges);
        String contentDigest = HexFormat.of().formatHex(digest.digest());

        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("format", "graymatter.knowledge-pack");
        manifest.put("formatVersion", "1.0");
        manifest.put("packId", packId);
        manifest.put("name", "Portable Agent Memory");
        manifest.put("contentDigestAlgorithm", "SHA-256");
        manifest.put("contentDigest", contentDigest);
        manifest.put("aclImportPolicy", "do-not-transplant");
        manifest.put("embeddingPolicy", "regenerate-on-import");
        manifest.put("counts", Map.of(
            "memoryEntries", 1,
            "contentData", 0,
            "edges", 1,
            "blobs", 0,
            "redactions", 0));
        byte[] manifestBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(manifest);

        KeyPair keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(keyPair.getPrivate());
        signer.update(manifestBytes);
        byte[] signature = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(Map.of(
            "algorithm", "Ed25519",
            "signedEntry", "manifest.json",
            "publicKeyFormat", "X.509",
            "publicKey", Base64.getEncoder().encodeToString(keyPair.getPublic().getEncoded()),
            "signature", Base64.getEncoder().encodeToString(signer.sign()),
            "trustModel", "self-contained-v1",
            "identityAssurance", spoofIdentityAssurance
                ? "publisher-verified"
                : "unverified-until-publisher-trust-binding"));

        if (tamperManifest) {
            manifest.put("name", "Tampered After Signing");
            manifestBytes = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(manifest);
        }
        if (tamperContent) {
            objects = (objectMapper.writeValueAsString(object) + " \n").getBytes(StandardCharsets.UTF_8);
        }

        try (ByteArrayOutputStream output = new ByteArrayOutputStream();
            ZipOutputStream zip = new ZipOutputStream(output, StandardCharsets.UTF_8)) {
            write(zip, "manifest.json", manifestBytes);
            write(zip, "objects.jsonl", objects);
            write(zip, "edges.jsonl", edges);
            write(zip, "signature.json", signature);
            zip.finish();
            return output.toByteArray();
        }
    }

    private void write(ZipOutputStream zip, String path, byte[] bytes) throws Exception {
        zip.putNextEntry(new ZipEntry(path));
        zip.write(bytes);
        zip.closeEntry();
    }
}
