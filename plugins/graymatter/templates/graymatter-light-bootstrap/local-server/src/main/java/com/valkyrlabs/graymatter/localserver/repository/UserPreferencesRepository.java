package com.valkyrlabs.graymatter.localserver.repository;

import com.valkyrlabs.graymatter.localserver.model.UserPreferences;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserPreferencesRepository extends JpaRepository<UserPreferences, UUID> {
    @EntityGraph(attributePaths = "principal")
    Optional<UserPreferences> findByPrincipalUsernameIgnoreCase(String username);
}
