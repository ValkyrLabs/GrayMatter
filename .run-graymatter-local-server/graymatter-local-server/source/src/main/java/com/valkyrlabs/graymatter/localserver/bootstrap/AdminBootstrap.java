package com.valkyrlabs.graymatter.localserver.bootstrap;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.model.UserPreferences;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.repository.UserPreferencesRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class AdminBootstrap implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final PrincipalRecordRepository principals;
    private final UserPreferencesRepository preferences;
    private final PasswordEncoder passwordEncoder;
    private final String username;
    private final String password;
    private final String displayName;

    public AdminBootstrap(
        PrincipalRecordRepository principals,
        UserPreferencesRepository preferences,
        PasswordEncoder passwordEncoder,
        @Value("${graymatter.admin.username}") String username,
        @Value("${graymatter.admin.password}") String password,
        @Value("${graymatter.admin.display-name}") String displayName) {
        this.principals = principals;
        this.preferences = preferences;
        this.passwordEncoder = passwordEncoder;
        this.username = username;
        this.password = password;
        this.displayName = displayName;
    }

    @Override
    @Transactional
    public void run(String... args) {
        PrincipalRecord principal = principals.findByUsernameIgnoreCase(username)
            .orElseGet(() -> principals.save(new PrincipalRecord(
                username,
                passwordEncoder.encode(password),
                displayName,
                "ROLE_ADMIN,ROLE_USER")));

        preferences.findByPrincipalUsernameIgnoreCase(principal.getUsername())
            .orElseGet(() -> preferences.save(new UserPreferences(principal, "dark", "local")));

        log.info("GrayMatter Local Server admin principal ready: {}", username);
    }
}
