package com.valkyrlabs.graymatter.localserver.controller;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.model.UserPreferences;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.repository.UserPreferencesRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:h2:mem:local-preferences-test;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.jpa.open-in-view=false"
})
@AutoConfigureMockMvc
class UserPreferencesControllerTest {
    @Autowired private MockMvc mockMvc;
    @Autowired private PrincipalRecordRepository principals;
    @Autowired private UserPreferencesRepository preferences;
    @Autowired private PasswordEncoder passwords;

    @Test
    void verifiesLocalIdentityAndUpdatesOnlyTheAuthenticatedOwnersPreferences() throws Exception {
        PrincipalRecord reader = principals.save(new PrincipalRecord(
            "preferences-reader", passwords.encode("fixture-reader-password"), "Reader", "ROLE_USER"));
        preferences.save(new UserPreferences(reader, "light", "private"));

        mockMvc.perform(get("/v1/UserPreferences/me").with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("admin"));

        mockMvc.perform(put("/v1/UserPreferences/me")
                .with(httpBasic("preferences-reader", "fixture-reader-password"))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"theme\":\"reader-theme\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("preferences-reader"))
            .andExpect(jsonPath("$.theme").value("reader-theme"));

        mockMvc.perform(get("/v1/UserPreferences/me").with(httpBasic("admin", "graymatter-light")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("admin"))
            .andExpect(jsonPath("$.theme").value("dark"));
    }

    @Test
    void rejectsMissingOrInvalidLocalCredentials() throws Exception {
        mockMvc.perform(get("/v1/UserPreferences/me")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/v1/UserPreferences/me").with(httpBasic("admin", "wrong-fixture-password")))
            .andExpect(status().isUnauthorized());
    }
}
