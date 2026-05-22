package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.repository.UserPreferencesRepository;
import com.valkyrlabs.graymatter.localserver.repository.WorkbookRecordRepository;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/graymatter")
public class DashboardController {

    private final PrincipalRecordRepository principals;
    private final UserPreferencesRepository preferences;
    private final MemoryEntryRepository memoryEntries;
    private final WorkbookRecordRepository workbooks;

    public DashboardController(
        PrincipalRecordRepository principals,
        UserPreferencesRepository preferences,
        MemoryEntryRepository memoryEntries,
        WorkbookRecordRepository workbooks) {
        this.principals = principals;
        this.preferences = preferences;
        this.memoryEntries = memoryEntries;
        this.workbooks = workbooks;
    }

    @GetMapping("/dashboard")
    public Map<String, Object> dashboard(Principal authenticated) {
        PrincipalRecord principal = principals.findByUsernameIgnoreCase(authenticated.getName())
            .orElseThrow();

        return Map.ofEntries(
            Map.entry("product", "GrayMatter Local Server"),
            Map.entry("generationMode", "thorapi-febe"),
            Map.entry("principal", Map.of(
                "id", principal.getId(),
                "username", principal.getUsername(),
                "displayName", principal.getDisplayName(),
                "roles", List.of(principal.authorityArray()))),
            Map.entry("coreServices", List.of(
                "RBAC",
                "Principal",
                "UserPreferences",
                "MemoryEntry",
                "Data Workbooks",
                "Mothership Sync",
                "Swarm Protocol",
                "Live Telemetry")),
            Map.entry("memoryEntryCount", memoryEntries.countByPrincipalUsernameIgnoreCase(principal.getUsername())),
            Map.entry("workbookCount", workbooks.countByOwnerUsernameIgnoreCase(principal.getUsername())),
            Map.entry("preferencesReady", preferences.findByPrincipalUsernameIgnoreCase(principal.getUsername()).isPresent()),
            Map.entry("storage", "local H2"),
            Map.entry("bundle", Map.of(
                "id", "graymatter-local",
                "generationMode", "thorapi-febe",
                "sourceTemplate", "graymatter-local",
                "customComponents", List.of(
                    "GrayMatterDashboard",
                    "MemoryEntryWorkbench",
                    "MothershipPromotionBridge",
                    "SwarmProtocolBridge",
                    "LiveTelemetryPanel"))),
            Map.entry("mothership", Map.of(
                "target", "https://valkyrlabs.com",
                "apiBase", "https://api-0.valkyrlabs.com/v1",
                "mode", "promotion-prepared")),
            Map.entry("swarmProtocol", Map.of(
                "protocolVersion", "graymatter-swarm-v0.1",
                "nodeRole", "light-node",
                "state", "LOCAL_ONLY")));
    }
}
