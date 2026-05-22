package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.model.PrincipalRecord;
import com.valkyrlabs.graymatter.localserver.repository.MemoryEntryRepository;
import com.valkyrlabs.graymatter.localserver.repository.PrincipalRecordRepository;
import com.valkyrlabs.graymatter.localserver.repository.WorkbookRecordRepository;
import java.lang.management.ManagementFactory;
import java.lang.management.OperatingSystemMXBean;
import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/graymatter/telemetry")
public class LiveTelemetryController {

    private final PrincipalRecordRepository principals;
    private final MemoryEntryRepository memoryEntries;
    private final WorkbookRecordRepository workbooks;

    public LiveTelemetryController(
        PrincipalRecordRepository principals,
        MemoryEntryRepository memoryEntries,
        WorkbookRecordRepository workbooks) {
        this.principals = principals;
        this.memoryEntries = memoryEntries;
        this.workbooks = workbooks;
    }

    @GetMapping("/status")
    public Map<String, Object> status(Principal authenticated) {
        PrincipalRecord principal = principals.findByUsernameIgnoreCase(authenticated.getName()).orElseThrow();
        Runtime runtime = Runtime.getRuntime();
        OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
        long usedMemoryMb = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024);
        long maxMemoryMb = runtime.maxMemory() / (1024 * 1024);
        long memoryEntryCount = memoryEntries.countByPrincipalUsernameIgnoreCase(principal.getUsername());
        long workbookCount = workbooks.countByOwnerUsernameIgnoreCase(principal.getUsername());

        return Map.ofEntries(
            Map.entry("panel", "Live Telemetry"),
            Map.entry("section", "System Equalizer"),
            Map.entry("generatedAt", Instant.now().toString()),
            Map.entry("principal", Map.of(
                "username", principal.getUsername(),
                "displayName", principal.getDisplayName(),
                "roles", List.of(principal.authorityArray()),
                "admin", List.of(principal.authorityArray()).contains("ROLE_ADMIN"))),
            Map.entry("mode", "compact"),
            Map.entry("metrics", List.of(
                metric("memory.entries", "MemoryEntry records", memoryEntryCount, "records", "ok"),
                metric("data.workbooks", "Data Workbooks", workbookCount, "workbooks", "ok"),
                metric("system.equalizer", "System Equalizer", "compact", "mode", "ok"),
                metric("system.heap.used.mb", "Heap used", usedMemoryMb, "MB", heapState(usedMemoryMb, maxMemoryMb)),
                metric("system.heap.max.mb", "Heap max", maxMemoryMb, "MB", "ok"),
                metric("system.load.average", "System load average", os.getSystemLoadAverage(), "load", "ok"),
                metric("system.processors", "Available processors", os.getAvailableProcessors(), "cores", "ok"))),
            Map.entry("sources", List.of(
                "/api/graymatter/dashboard",
                "/api/graymatter/swarm/protocol",
                "/api/graymatter/sync/status",
                "java.lang.management")));
    }

    private Map<String, Object> metric(String id, String label, Object value, String unit, String state) {
        return Map.of(
            "id", id,
            "label", label,
            "value", value,
            "unit", unit,
            "state", state);
    }

    private String heapState(long usedMemoryMb, long maxMemoryMb) {
        if (maxMemoryMb <= 0) {
            return "unknown";
        }
        double ratio = (double) usedMemoryMb / (double) maxMemoryMb;
        if (ratio > 0.85) {
            return "warn";
        }
        return "ok";
    }
}
