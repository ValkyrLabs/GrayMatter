package com.valkyrlabs.graymatter.localserver.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;

import com.valkyrlabs.graymatter.localserver.repository.KnowledgePackRepository;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:starter-pack-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "graymatter.starter-knowledge-pack.enabled=true"
})
class StarterKnowledgePackBootstrapTest {

    @Autowired
    private KnowledgePackRepository knowledgePacks;

    @Autowired
    private MemoryEntryRepository memoryEntries;

    @Test
    void loadsVettedStarterKnowledgeIntoH2Idempotently() {
        assertThat(knowledgePacks.countByOwnerUsernameIgnoreCase("admin")).isEqualTo(1);
        assertThat(memoryEntries.countByPrincipalUsernameIgnoreCase("admin")).isGreaterThanOrEqualTo(12);
    }
}
