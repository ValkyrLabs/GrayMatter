package com.valkyrlabs.graymatter.localserver.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_preferences")
public class UserPreferences {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "principal_id", nullable = false, unique = true)
    private PrincipalRecord principal;

    @Column(nullable = false)
    private String theme = "dark";

    @Column(nullable = false)
    private String defaultMemoryScope = "local";

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    protected UserPreferences() {
    }

    public UserPreferences(PrincipalRecord principal, String theme, String defaultMemoryScope) {
        this.principal = principal;
        this.theme = theme;
        this.defaultMemoryScope = defaultMemoryScope;
    }

    public UUID getId() {
        return id;
    }

    public PrincipalRecord getPrincipal() {
        return principal;
    }

    public String getTheme() {
        return theme;
    }

    public void setTheme(String theme) {
        this.theme = theme;
        this.updatedAt = Instant.now();
    }

    public String getDefaultMemoryScope() {
        return defaultMemoryScope;
    }

    public void setDefaultMemoryScope(String defaultMemoryScope) {
        this.defaultMemoryScope = defaultMemoryScope;
        this.updatedAt = Instant.now();
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
