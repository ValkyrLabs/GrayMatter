package com.valkyrlabs.graymatter.localserver.association;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.generated.api.MemoryAssociationRepository;
import com.valkyrlabs.graymatter.generated.model.MemoryAssociation;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.model.KnowledgePackRecord;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackExportService;
import jakarta.persistence.EntityManagerFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.hibernate.boot.MetadataSources;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:association-owner;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop", "graymatter.starter-knowledge-pack.enabled=false"
})
@AutoConfigureMockMvc
class MemoryAssociationTest {
    private static final String BASE = "/v1/graymatter/memory/associations";
    private static final String WRITE = "/v1/MemoryEntry/write";
    @Autowired KnowledgePackExportService exporter;
    @Autowired KnowledgePackImportService importer;
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired PrincipalRecordRepository principals;
    @Autowired MemoryAssociationRepository associations;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManagerFactory emf;
    @Autowired PasswordEncoder passwords;

    @BeforeEach
    void prepareReader() {
        if (principals.findByUsernameIgnoreCase("reader").isEmpty())
            principals.save(new PrincipalRecord("reader", passwords.encode("reader-pass"), "Reader", "ROLE_USER"));
    }

    @Test
    void boundsAndFramesExactUnicodeWithoutSilentlyAliasingInvalidInputs() throws Exception {
        UUID a = UUID.fromString("00112233-4455-4677-8899-aabbccddeeff");
        UUID b = UUID.fromString("ffeeddcc-bbaa-4988-8766-554433221100");
        var tuple = new AssociationProtocol.Tuple(a, b, "Résumé 🎯");
        assertThat(tuple.hash()).isEqualTo("6e4153662fc55cd63718142a97e523d0e628c290ec74527bbf65fd9b23e816b5");
        assertThat(AssociationProtocol.validRelation("🎯".repeat(128))).isTrue();
        for (String label : List.of("", "   ", "🎯".repeat(129), "x\u007f", "x\u0084z", "x\ud800",
                "\udfff", "\u00a0x", "x\u202f", "x\tq", "x\u0000x"))
            assertThat(AssociationProtocol.validRelation(label)).isFalse();
        String valid = mapper.writeValueAsString(Map.of("fromId", a, "toId", b, "relation", "label"));
        for (String body : List.of(valid + " {}", valid.replace("{", "{\"relation\":\"other\","),
                valid.replace("{", "{\"ownerId\":null,"), valid.replace(b.toString(), a.toString()),
                valid.replace(a.toString(), "1-2-3-4-5"), valid.replace("\"label\"", "[]"))) {
            assertThatThrownBy(() -> AssociationProtocol.parse(body.getBytes(java.nio.charset.StandardCharsets.UTF_8))).isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void malformedUtf8IsRejectedBeforeItCanBecomeAReplacementCharacterLabel() throws Exception {
        var a = memory("reader", "one");
        var b = memory("reader", "two");
        byte[] bytes = mapper.writeValueAsBytes(pair(a, b, "~"));
        for (int i = 0; i < bytes.length; i++) if (bytes[i] == '~') bytes[i] = (byte) 0xff;
        assertThat(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
            .with(httpBasic("reader", "reader-pass")).content(bytes)).andReturn().getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void writesOneRealGeneratedRowWithAuditAndNoRawCrudRoute() throws Exception {
        var a = memory("reader", "one");
        var b = memory("reader", "two");
        var pair = pair(a, b, "résumé");
        var fresh = result(call("reader", BASE, pair), 201);
        String reference = fresh.path("associationRef").textValue();
        assertThat(fresh.path("replayed").asBoolean()).isFalse();
        var repeated = result(call("reader", BASE, pair), 200);
        assertThat(repeated.path("associationRef").asText()).isEqualTo(reference);
        assertThat(repeated.path("recordedAt")).isEqualTo(fresh.path("recordedAt"));
        assertThat(result(call("reader", BASE + "/" + reference, null), 200)).isEqualTo(repeated);
        var reversed = result(call("reader", BASE, pair(b, a, "résumé")), 201);
        assertThat(reversed.path("associationRef").asText()).isNotEqualTo(reference);
        var otherCase = result(call("reader", BASE, pair(a, b, "Résumé")), 201);
        assertThat(otherCase.path("tupleHash")).isNotEqualTo(fresh.path("tupleHash"));
        var first = associations.findById(UUID.fromString(reference)).orElseThrow();
        UUID actor = principals.findByUsernameIgnoreCase("reader").orElseThrow().getId();
        assertThat(first.getOwnerId()).isEqualTo(actor);
        assertThat(first.getLastModifiedById()).isEqualTo(actor);
        assertThat(first.getCreatedDate()).isNotNull();
        assertThat(emf.getMetamodel().getEntities().stream().map(e -> e.getJavaType().getName())
            .filter(n -> n.contains(".generated."))).containsExactly("com.valkyrlabs.graymatter.generated.model.MemoryAssociation");
        assertThat(call("admin", "/v1/MemoryAssociation", pair).getStatus()).isIn(404, 405);
        assertThat(call("admin", "/v1/MemoryAssociation/" + reference, null).getStatus()).isIn(404, 405);
        assertThat(mvc.perform(get(BASE + "/capabilities")).andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void everyReadAndReplayRechecksOwnerAndBothCurrentSources() throws Exception {
        var a = memory("reader", "one");
        var b = memory("reader", "two");
        var outsider = memory("admin", "foreign");
        var pair = pair(a, b, "navigation");
        var fresh = result(call("reader", BASE, pair), 201);
        String read = BASE + "/" + fresh.path("associationRef").asText();
        assertThat(call("admin", read, null).getStatus()).isEqualTo(404);
        assertThat(call("admin", BASE, pair).getStatus()).isEqualTo(404);
        assertThat(call("reader", BASE, pair(a, outsider, "navigation")).getStatus()).isEqualTo(404);
        UUID otherOwner = principals.findByUsernameIgnoreCase("admin").orElseThrow().getId();
        jdbc.update("update memory_entry set principal_id=? where id=?", otherOwner, UUID.fromString(b.path("id").asText()));
        assertThat(call("reader", read, null).getStatus()).isEqualTo(404);
        assertThat(call("reader", BASE, pair).getStatus()).isEqualTo(404);
        assertThat(call("admin", read, null).getStatus()).isEqualTo(404);
    }

    @Test
    void physicalDeleteCascadesBothDirectionsAcrossOwnersAndCannotReviveOldReferences() throws Exception {
        var a = memory("reader", "one");
        var b = memory("reader", "two");
        var first = result(call("reader", BASE, pair(a, b, "navigation")), 201);
        var second = result(call("reader", BASE, pair(b, a, "navigation")), 201);
        UUID id = UUID.fromString(a.path("id").asText());
        UUID reader = principals.findByUsernameIgnoreCase("reader").orElseThrow().getId();
        UUID otherOwner = principals.findByUsernameIgnoreCase("admin").orElseThrow().getId();
        jdbc.update("update memory_association set owner_id=? where id=?", otherOwner,
            UUID.fromString(second.path("associationRef").asText()));
        jdbc.update("delete from memory_entry where id=?", id);
        assertThat(jdbc.queryForObject("select count(*) from memory_association where from_id=? or to_id=?",
            Integer.class, id, id)).isZero();
        jdbc.update("insert into memory_entry(id, principal_id, type, text, source_channel, created_at, modified_at) "
            + "values (?, ?, 'context', 'replacement', 'test', current_timestamp, current_timestamp)", id, reader);
        for (var edge : List.of(first, second)) {
            assertThat(call("reader", BASE + "/" + edge.path("associationRef").asText(), null).getStatus()).isEqualTo(404);
        }
        var next = result(call("reader", BASE, pair(a, b, "navigation")), 201);
        assertThat(next.path("associationRef")).isNotEqualTo(first.path("associationRef"));
        assertThat(next.path("tupleHash")).isEqualTo(first.path("tupleHash"));
    }

    @Test
    void importedPackLinksArePrivateNavigationAndLeaveTheSignedArchiveIntact() throws Exception {
        var source = memory("admin", "archive member");
        var local = memory("reader", "note");
        byte[] archive = exporter.export("admin").archive();
        UUID pack = importer.importArchive("reader", archive).knowledgePack().id();
        UUID member = jdbc.queryForObject("select id from memory_entry where knowledge_pack_id=? and source_object_id=?",
            UUID.class, pack, source.path("id").asText());
        var pair = Map.of("fromId", local.path("id").asText(), "toId", member.toString(), "relation", "supersedes");
        var first = result(call("reader", BASE, pair), 201);
        assertThat(call("admin", BASE + "/" + first.path("associationRef").asText(), null).getStatus()).isEqualTo(404);
        assertThat(call("reader", "/v1/graymatter/memory/" + local.path("id").asText(), null).getStatus()).isEqualTo(200);
        assertThat(call("reader", "/v1/graymatter/memory/" + member, null).getStatus()).isEqualTo(200);
        assertThat(call("reader", "/v1/knowledge-packs/" + pack + "/archive", null).getContentAsByteArray()).isEqualTo(archive);
        assertThat(importer.importArchive("reader", archive).alreadyImported()).isTrue();
        assertThat(result(call("reader", BASE, pair), 200).path("associationRef")).isEqualTo(first.path("associationRef"));
    }

    @Test
    void competingFirstWritersCommitExactlyOneRow() throws Exception {
        var pair = pair(memory("reader", "shared"), memory("reader", "target"), "concurrent");
        var pool = Executors.newFixedThreadPool(4);
        var start = new CountDownLatch(1);
        try {
            var replies = new ArrayList<java.util.concurrent.Future<MockHttpServletResponse>>();
            for (int i = 0; i < 4; i++) {
                replies.add(pool.submit(() -> {
                    start.await();
                    return call("reader", BASE, pair);
                }));
            }
            start.countDown();
            var statuses = new ArrayList<Integer>();
            var ids = new java.util.HashSet<String>();
            for (var reply : replies) {
                var response = reply.get(20, TimeUnit.SECONDS);
                statuses.add(response.getStatus());
                ids.add(mapper.readTree(response.getContentAsByteArray()).path("associationRef").asText());
            }
            assertThat(statuses).containsExactlyInAnyOrder(201, 200, 200, 200);
            assertThat(ids).hasSize(1);
            assertThat(jdbc.queryForObject("select count(*) from memory_association where from_id=? and to_id=?",
                Integer.class, UUID.fromString(pair.get("fromId")), UUID.fromString(pair.get("toId")))).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void genuineDefaultSchemaConstraintsCannotAttestAnOrmMappedIntoAnotherSchema() {
        var registry = new StandardServiceRegistryBuilder()
            .applySetting("hibernate.connection.driver_class", "org.h2.Driver")
            .applySetting("hibernate.connection.url",
                "jdbc:h2:mem:association-wrong-schema;INIT=CREATE SCHEMA IF NOT EXISTS mapped")
            .applySetting("hibernate.default_schema", "mapped")
            .applySetting("hibernate.hbm2ddl.auto", "create-drop")
            .build();
        try {
            try (var foreignMapping = new MetadataSources(registry)
                .addAnnotatedClass(MemoryAssociation.class).addAnnotatedClass(MemoryEntry.class)
                .addAnnotatedClass(PrincipalRecord.class).addAnnotatedClass(KnowledgePackRecord.class)
                .buildMetadata().buildSessionFactory()) {
                var constraintProbe = new AssociationConstraints(jdbc, foreignMapping);
                assertThatThrownBy(constraintProbe::afterPropertiesSet).isInstanceOf(ResponseStatusException.class)
                    .hasMessageContaining("Unsupported memory association table mapping");
                assertThatThrownBy(constraintProbe::requireReady).isInstanceOf(ResponseStatusException.class)
                    .hasMessageContaining("Unsupported memory association table mapping");
            }
        } finally {
            StandardServiceRegistryBuilder.destroy(registry);
        }
    }

    @Test
    void wronglyNamedLookalikeCascadeAndCompositeUniquenessFailClosedBeforeWrite() throws Exception {
        var pair = pair(memory("reader", "one"), memory("reader", "two"), "constraint-test");
        jdbc.execute("alter table memory_association drop constraint fk_memassoc_from");
        try {
            jdbc.execute("alter table memory_association add constraint fk_memassoc_from "
                + "foreign key(to_id) references memory_entry(id) on delete cascade");
            assertThat(call("reader", BASE + "/capabilities", null).getStatus()).isEqualTo(503);
            assertThat(call("reader", BASE, pair).getStatus()).isEqualTo(503);
        } finally {
            jdbc.execute("alter table memory_association drop constraint if exists fk_memassoc_from");
            jdbc.execute("alter table memory_association add constraint fk_memassoc_from "
                + "foreign key(from_id) references memory_entry(id) on delete cascade");
        }
        jdbc.execute("alter table memory_association drop constraint uk_memassoc_write");
        try {
            jdbc.execute("create unique index composite_impostor on memory_association(write_key_hash, owner_id)");
            assertThat(call("reader", BASE, pair).getStatus()).isEqualTo(503);
        } finally {
            jdbc.execute("drop index if exists composite_impostor");
            jdbc.execute("alter table memory_association add constraint uk_memassoc_write unique(write_key_hash)");
        }
        assertThat(call("reader", BASE, pair).getStatus()).isEqualTo(201);
    }

    private JsonNode memory(String user, String text) throws Exception {
        return result(call(user, WRITE, Map.of("text", text)), 200);
    }

    private static Map<String, String> pair(JsonNode a, JsonNode b, String label) {
        return Map.of("fromId", a.path("id").asText(), "toId", b.path("id").asText(), "relation", label);
    }

    private MockHttpServletResponse call(String user, String path, Object body) throws Exception {
        MockHttpServletRequestBuilder builder = body == null ? get(path)
            : post(path).contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsBytes(body));
        return mvc.perform(builder.with(httpBasic(user, "reader".equals(user) ? "reader-pass" : "graymatter-light")))
            .andReturn().getResponse();
    }

    private JsonNode result(MockHttpServletResponse response, int expected) throws Exception {
        assertThat(response.getStatus()).isEqualTo(expected);
        return mapper.readTree(response.getContentAsByteArray());
    }
}
