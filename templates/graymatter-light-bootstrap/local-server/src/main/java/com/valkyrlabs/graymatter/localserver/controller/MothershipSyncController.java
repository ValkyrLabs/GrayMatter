package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.repository.WorkbookRecordRepository;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/graymatter/sync")
public class MothershipSyncController {

    private final PrincipalRecordRepository principals;
    private final MemoryEntryRepository memoryEntries;
    private final WorkbookRecordRepository workbooks;

    public MothershipSyncController(
        PrincipalRecordRepository principals,
        MemoryEntryRepository memoryEntries,
        WorkbookRecordRepository workbooks) {
        this.principals = principals;
        this.memoryEntries = memoryEntries;
        this.workbooks = workbooks;
    }

    @GetMapping("/status")
    public Map<String, Object> status(Principal authenticated) {
        PrincipalRecord principal = findPrincipal(authenticated);
        return syncStatus(principal, "READY_FOR_PROMOTION");
    }

    @PostMapping("/mothership")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> promoteToMothership(Principal authenticated) {
        PrincipalRecord principal = findPrincipal(authenticated);
        return Map.ofEntries(
            Map.entry("status", "PROMOTION_PREPARED"),
            Map.entry("message", "Local GrayMatter light bundle is packaged for authenticated mothership synchronization."),
            Map.entry("target", "https://valkyrlabs.com"),
            Map.entry("apiBase", "https://api-0.valkyrlabs.com/v1"),
            Map.entry("requiresAuth", "VALKYR_AUTH_TOKEN or hosted valkyrlabs.com login"),
            Map.entry("generatedAt", Instant.now().toString()),
            Map.entry("principal", principal.getUsername()),
            Map.entry("payload", Map.of(
                "bundle", "graymatter-local",
                "generationMode", "thorapi-febe",
                "memoryEntryCount", memoryEntries.countByPrincipalUsernameIgnoreCase(principal.getUsername()),
                "workbookCount", workbooks.countByOwnerUsernameIgnoreCase(principal.getUsername()),
                "swarmProtocol", "graymatter-swarm-v0.1")),
            Map.entry("nextSteps", List.of(
                "Authenticate against https://api-0.valkyrlabs.com/v1 with VALKYR_AUTH_TOKEN.",
                "POST the generated application-bundle contract and local memory/workbook payload to the hosted promotion API.",
                "Confirm hosted RBAC scope before switching clients from local light mode to full GrayMatter.")));
    }

    private PrincipalRecord findPrincipal(Principal authenticated) {
        return principals.findByUsernameIgnoreCase(authenticated.getName()).orElseThrow();
    }

    private Map<String, Object> syncStatus(PrincipalRecord principal, String state) {
        return Map.ofEntries(
            Map.entry("state", state),
            Map.entry("target", "https://valkyrlabs.com"),
            Map.entry("apiBase", "https://api-0.valkyrlabs.com/v1"),
            Map.entry("mode", "local-light-to-full"),
            Map.entry("applicationBundle", "graymatter-local"),
            Map.entry("generationMode", "thorapi-febe"),
            Map.entry("principal", principal.getUsername()),
            Map.entry("memoryEntryCount", memoryEntries.countByPrincipalUsernameIgnoreCase(principal.getUsername())),
            Map.entry("workbookCount", workbooks.countByOwnerUsernameIgnoreCase(principal.getUsername())),
            Map.entry("auth", Map.of(
                "required", true,
                "environmentVariable", "VALKYR_AUTH_TOKEN",
                "hostedLogin", "https://valkyrlabs.com/login")),
            Map.entry("swarmProtocol", "graymatter-swarm-v0.1"));
    }
}
