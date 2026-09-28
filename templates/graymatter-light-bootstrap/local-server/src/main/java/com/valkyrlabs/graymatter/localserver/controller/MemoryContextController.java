package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.service.MemoryContextService;
import java.security.Principal;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1")
public class MemoryContextController {
    private final MemoryContextService contexts;

    public MemoryContextController(MemoryContextService contexts) {
        this.contexts = contexts;
    }

    @PostMapping("/graymatter/retrieval-context")
    public MemoryContextService.ContextResponse context(Principal authenticated,
        @RequestBody MemoryContextService.ContextRequest request) {
        return contexts.compile(authenticated.getName(), request, true);
    }

    @PostMapping("/graymatter-retrieval-receipts")
    public MemoryContextService.ContextResponse receipt(Principal authenticated,
        @RequestBody MemoryContextService.ContextRequest request) {
        return contexts.compile(authenticated.getName(), request,
            request.includeText() == null || request.includeText());
    }

    @GetMapping("/graymatter-retrieval-receipts/{id}")
    public MemoryContextService.ReceiptStatus receipt(Principal authenticated, @PathVariable UUID id) {
        return contexts.receipt(authenticated.getName(), id);
    }

    @PostMapping({"/graymatter/retrieval-context/{id}/recompress",
                  "/graymatter/retrieval-context/{id}/fork"})
    public MemoryContextService.ContextResponse recompress(Principal authenticated, @PathVariable UUID id,
        @RequestBody MemoryContextService.ContextRequest request) {
        return contexts.recompress(authenticated.getName(), id, request, true);
    }

    @GetMapping("/graymatter/retrieval-context/{id}/hydrate/{memoryId}")
    public MemoryContextService.HydrationResponse hydrate(Principal authenticated, @PathVariable UUID id,
        @PathVariable UUID memoryId, @RequestParam(defaultValue = "1000") int maxTokens) {
        return contexts.hydrate(authenticated.getName(), id, memoryId, maxTokens);
    }
}
