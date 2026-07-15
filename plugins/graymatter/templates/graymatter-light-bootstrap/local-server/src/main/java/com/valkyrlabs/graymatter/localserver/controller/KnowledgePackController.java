package com.valkyrlabs.graymatter.localserver.controller;

import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService.ImportResult;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService.KnowledgePackGraph;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService.KnowledgePackNotFoundException;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService.KnowledgePackSummary;
import com.valkyrlabs.graymatter.localserver.service.KnowledgePackImportService.KnowledgePackValidationException;
import java.io.IOException;
import java.security.Principal;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/v1/knowledge-packs")
public class KnowledgePackController {

    private final KnowledgePackImportService importer;

    public KnowledgePackController(KnowledgePackImportService importer) {
        this.importer = importer;
    }

    @PostMapping(value = "/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public ImportResult importPack(Principal authenticated, @RequestPart("file") MultipartFile file) {
        try {
            return importer.importArchive(authenticated.getName(), file.getBytes());
        } catch (IOException error) {
            throw new KnowledgePackValidationException("KnowledgePack upload could not be read", error);
        }
    }

    @GetMapping
    public List<KnowledgePackSummary> list(Principal authenticated) {
        return importer.list(authenticated.getName());
    }

    @GetMapping("/{id}")
    public KnowledgePackSummary detail(Principal authenticated, @PathVariable UUID id) {
        return importer.detail(authenticated.getName(), id);
    }

    @GetMapping("/{id}/graph")
    public KnowledgePackGraph graph(Principal authenticated, @PathVariable UUID id) {
        return importer.graph(authenticated.getName(), id);
    }

    @GetMapping("/{id}/archive")
    public ResponseEntity<byte[]> archive(Principal authenticated, @PathVariable UUID id) {
        KnowledgePackSummary summary = importer.detail(authenticated.getName(), id);
        return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + safeFilename(summary.name()) + ".gmkp\"")
            .contentType(MediaType.parseMediaType("application/vnd.valkyrlabs.graymatter-knowledge-pack+zip"))
            .body(importer.archive(authenticated.getName(), id));
    }

    @ExceptionHandler(KnowledgePackValidationException.class)
    ResponseEntity<ErrorResponse> invalid(KnowledgePackValidationException error) {
        return ResponseEntity.badRequest().body(new ErrorResponse("INVALID_KNOWLEDGE_PACK", error.getMessage()));
    }

    @ExceptionHandler(KnowledgePackNotFoundException.class)
    ResponseEntity<ErrorResponse> notFound(KnowledgePackNotFoundException error) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(new ErrorResponse("KNOWLEDGE_PACK_NOT_FOUND", error.getMessage()));
    }

    private String safeFilename(String value) {
        String safe = value == null ? "graymatter-knowledge-pack" : value.replaceAll("[^A-Za-z0-9._-]+", "-");
        safe = safe.replaceAll("(^-+|-+$)", "");
        return safe.isBlank() ? "graymatter-knowledge-pack" : safe.substring(0, Math.min(safe.length(), 120));
    }

    record ErrorResponse(String code, String message) {
    }
}
