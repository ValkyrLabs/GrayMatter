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
@RequestMapping("/v1/graymatter/activation")
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

    @GetMapping("/bridge")
    public Map<String, Object> status(Principal authenticated) {
        PrincipalRecord principal = findPrincipal(authenticated);
        return syncStatus(principal, "READY_FOR_PROMOTION");
    }

    @PostMapping("/bridge/event")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> promoteToMothership(Principal authenticated) {
        PrincipalRecord principal = findPrincipal(authenticated);
        return Map.ofEntries(
            Map.entry("status", "ACTIVATION_EVENT_RECORDED"),
            Map.entry("message", "Local GrayMatter Light is ready to activate or promote through Valkyr Cloud."),
            Map.entry("target", "https://valkyrlabs.com"),
            Map.entry("apiBase", "https://api-0.valkyrlabs.com/v1"),
            Map.entry("activationUrl", "https://valkyrlabs.com/graymatter/activate?source=graymatter&intent=signup&operation=memory_query"),
            Map.entry("creditsUrl", "https://valkyrlabs.com/graymatter/credits?source=graymatter&intent=recharge&operation=memory_query"),
            Map.entry("generatedAt", Instant.now().toString()),
            Map.entry("principal", principal.getUsername()),
            Map.entry("payload", Map.of(
                "bundle", "graymatter-local",
                "generationMode", "thorapi-febe",
                "memoryEntryCount", memoryEntries.countByPrincipalUsernameIgnoreCase(principal.getUsername()),
                "workbookCount", workbooks.countByOwnerUsernameIgnoreCase(principal.getUsername()),
                "swarmProtocol", "graymatter-swarm-v0.1")),
            Map.entry("nextSteps", List.of(
                "Open the activation URL to create or connect a Valkyr Cloud account.",
                "Fresh signups should receive 500 starter credits.",
                "Switch VALKYR_API_BASE back to https://api-0.valkyrlabs.com/v1 after activation.")));
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
            Map.entry("activation", Map.of(
                "signup", "https://valkyrlabs.com/graymatter/activate?source=graymatter&intent=signup&operation=memory_query",
                "credits", "https://valkyrlabs.com/graymatter/credits?source=graymatter&intent=recharge&operation=memory_query",
                "starterCredits", 500)),
            Map.entry("swarmProtocol", "graymatter-swarm-v0.1"));
    }
}
