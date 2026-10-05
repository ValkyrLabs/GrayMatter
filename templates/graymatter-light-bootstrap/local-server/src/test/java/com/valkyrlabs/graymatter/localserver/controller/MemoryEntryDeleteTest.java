package com.valkyrlabs.graymatter.localserver.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemorySearchIndexRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

/** DELETE /v1/MemoryEntry/{id}: declared in the api-0 contract, answered 405 by Lite until 2026-09-30. */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:memory-delete-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "graymatter.starter-knowledge-pack.enabled=false"
})
@AutoConfigureMockMvc
class MemoryEntryDeleteTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired MemoryEntryRepository memories;
    @Autowired MemorySearchIndexRepository indexes;
    @Autowired PrincipalRecordRepository principals;
    @Autowired PasswordEncoder passwords;

    @BeforeEach
    void reset() {
        indexes.deleteAll();
        memories.deleteAll();
        if (principals.findByUsernameIgnoreCase("reader").isEmpty()) {
            principals.save(new PrincipalRecord("reader", passwords.encode("reader-password"), "Reader", "ROLE_USER"));
        }
    }

    @Test
    void theOwnerDeletesAMemoryAndItsSearchProjection() throws Exception {
        UUID id = write("admin", "graymatter-light", "[bash] a logged command that is not knowledge");
        assertThat(indexes.existsById(id)).isTrue();

        mvc.perform(delete("/v1/MemoryEntry/" + id).with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isNoContent());

        assertThat(memories.existsById(id)).isFalse();
        assertThat(indexes.existsById(id)).isFalse();
        mvc.perform(get("/v1/MemoryEntry/" + id).with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isNotFound());
        // Deleting again: already gone.
        mvc.perform(delete("/v1/MemoryEntry/" + id).with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isNotFound());
    }

    @Test
    void anotherPrincipalCannotDeleteOrEvenDetectTheMemory() throws Exception {
        UUID id = write("admin", "graymatter-light", "Admin-only finding about a device");

        mvc.perform(delete("/v1/MemoryEntry/" + id).with(httpBasic("reader", "reader-password")))
            .andExpect(status().isNotFound());
        mvc.perform(delete("/v1/MemoryEntry/" + id)).andExpect(status().isUnauthorized());

        assertThat(memories.existsById(id)).isTrue();
        assertThat(indexes.existsById(id)).isTrue();
    }

    private UUID write(String user, String password, String text) throws Exception {
        String body = mvc.perform(post("/v1/MemoryEntry/write").with(httpBasic(user, password))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("type", "context", "text", text, "tags", List.of("t")))))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        return UUID.fromString(mapper.readTree(body).path("id").asText());
    }
}
