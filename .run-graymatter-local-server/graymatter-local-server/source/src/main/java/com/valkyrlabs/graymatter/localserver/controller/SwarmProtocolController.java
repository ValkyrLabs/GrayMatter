package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.repository.WorkbookRecordRepository;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping({"/api/graymatter/swarm", "/api/v1/SwarmOps"})
public class SwarmProtocolController {

    private final PrincipalRecordRepository principals;
    private final MemoryEntryRepository memoryEntries;
    private final WorkbookRecordRepository workbooks;

    public SwarmProtocolController(
        PrincipalRecordRepository principals,
        MemoryEntryRepository memoryEntries,
        WorkbookRecordRepository workbooks) {
        this.principals = principals;
        this.memoryEntries = memoryEntries;
        this.workbooks = workbooks;
    }

    @GetMapping({"/protocol", "/graph"})
    public Map<String, Object> protocol(Principal authenticated) {
        PrincipalRecord principal = findPrincipal(authenticated);
        Map<String, Object> node = localNode(principal);
        return Map.ofEntries(
            Map.entry("protocolVersion", "graymatter-swarm-v0.1"),
            Map.entry("state", "LOCAL_LIGHT_READY"),
            Map.entry("mothership", "https://valkyrlabs.com"),
            Map.entry("apiBase", "https://api-0.valkyrlabs.com/v1"),
            Map.entry("node", node),
            Map.entry("nodes", List.of(node)),
            Map.entry("edges", List.of(Map.of(
                "from", node.get("nodeId"),
                "to", "valkyrlabs-mothership",
                "type", "promotion-sync",
                "state", "prepared"))),
            Map.entry("capabilities", List.of(
                "local-memory",
                "data-workbooks",
                "thorapi-febe-bundle",
                "promotion-sync",
                "rbac-session",
                "SwarmOps")),
            Map.entry("endpoints", List.of(
                "/api/graymatter/dashboard",
                "/api/graymatter/sync/status",
                "/api/graymatter/sync/mothership",
                "/api/graymatter/swarm/protocol",
                "/api/v1/SwarmOps/graph",
                "/MemoryEntry",
                "/Workbook")),
            Map.entry("generatedAt", Instant.now().toString()));
    }

    @GetMapping("/agents")
    public Map<String, Object> agents(Principal authenticated) {
        PrincipalRecord principal = findPrincipal(authenticated);
        return Map.of(
            "protocolVersion", "graymatter-swarm-v0.1",
            "agents", List.of(localNode(principal)));
    }

    private PrincipalRecord findPrincipal(Principal authenticated) {
        return principals.findByUsernameIgnoreCase(authenticated.getName()).orElseThrow();
    }

    private Map<String, Object> localNode(PrincipalRecord principal) {
        String seed = principal.getUsername() + ":graymatter-local-light";
        String nodeId = "graymatter-light-" + UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8));
        return Map.ofEntries(
            Map.entry("nodeId", nodeId),
            Map.entry("role", "light-node"),
            Map.entry("principal", principal.getUsername()),
            Map.entry("bundle", "graymatter-local"),
            Map.entry("memoryEntryCount", memoryEntries.countByPrincipalUsernameIgnoreCase(principal.getUsername())),
            Map.entry("workbookCount", workbooks.countByOwnerUsernameIgnoreCase(principal.getUsername())),
            Map.entry("heartbeatTtlSeconds", 60),
            Map.entry("state", "READY"));
    }
}
