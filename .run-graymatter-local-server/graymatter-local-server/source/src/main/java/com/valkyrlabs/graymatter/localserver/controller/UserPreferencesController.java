package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.UserPreferences;
import com.valkyrlabs.graymatter.localserver.repository.UserPreferencesRepository;
import java.security.Principal;
import java.time.Instant;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/user-preferences")
public class UserPreferencesController {

    private final UserPreferencesRepository preferences;

    public UserPreferencesController(UserPreferencesRepository preferences) {
        this.preferences = preferences;
    }

    @GetMapping("/me")
    public UserPreferencesResponse mine(Principal authenticated) {
        return preferences.findByPrincipalUsernameIgnoreCase(authenticated.getName())
            .map(UserPreferencesResponse::from)
            .orElseThrow();
    }

    @PutMapping("/me")
    public UserPreferencesResponse update(
        Principal authenticated,
        @RequestBody UpdateUserPreferencesRequest request) {
        UserPreferences current = preferences.findByPrincipalUsernameIgnoreCase(authenticated.getName())
            .orElseThrow();
        if (request.theme() != null && !request.theme().isBlank()) {
            current.setTheme(request.theme());
        }
        if (request.defaultMemoryScope() != null && !request.defaultMemoryScope().isBlank()) {
            current.setDefaultMemoryScope(request.defaultMemoryScope());
        }
        return UserPreferencesResponse.from(preferences.save(current));
    }

    public record UpdateUserPreferencesRequest(String theme, String defaultMemoryScope) {
    }

    public record UserPreferencesResponse(
        UUID id,
        String username,
        String theme,
        String defaultMemoryScope,
        Instant updatedAt) {
        static UserPreferencesResponse from(UserPreferences preferences) {
            return new UserPreferencesResponse(
                preferences.getId(),
                preferences.getPrincipal().getUsername(),
                preferences.getTheme(),
                preferences.getDefaultMemoryScope(),
                preferences.getUpdatedAt());
        }
    }
}
