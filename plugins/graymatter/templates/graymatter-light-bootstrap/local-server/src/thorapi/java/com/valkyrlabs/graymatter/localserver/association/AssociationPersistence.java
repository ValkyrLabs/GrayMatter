package com.valkyrlabs.graymatter.localserver.association;

import com.valkyrlabs.graymatter.generated.api.MemoryAssociationRepository;
import com.valkyrlabs.graymatter.generated.model.MemoryAssociation;
import com.valkyrlabs.graymatter.localserver.model.MemoryEntry;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.FilterType;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.orm.jpa.persistenceunit.ManagedClassNameFilter;
import org.springframework.security.core.context.SecurityContextHolder;

@Configuration(proxyBeanMethods = false)
@EntityScan(basePackageClasses = { MemoryEntry.class, MemoryAssociation.class })
@EnableJpaRepositories(basePackageClasses = { MemoryEntryRepository.class, MemoryAssociationRepository.class },
    includeFilters = {
        @ComponentScan.Filter(type = FilterType.REGEX, pattern = "com\\.valkyrlabs\\.graymatter\\.localserver\\.repository\\..*"),
        @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = MemoryAssociationRepository.class)
    })
class AssociationPersistence {
    @Bean
    ManagedClassNameFilter liteEntities() {
        String localPackage = MemoryEntry.class.getPackageName() + ".";
        return name -> name.startsWith(localPackage) || name.equals(MemoryAssociation.class.getName());
    }

    @Bean("thorApiAuditorService")
    AuditorAware<UUID> liteAuditor(JdbcTemplate jdbc) {
        return () -> {
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth == null || !auth.isAuthenticated()) return Optional.empty();
            // JDBC avoids flushing the JPA entity under construction in the generated audit listener.
            return jdbc.query("select id from principal where lower(username) = lower(?) and enabled",
                result -> result.next() ? Optional.of(result.getObject(1, UUID.class)) : Optional.empty(), auth.getName());
        };
    }
}
