package com.valkyrlabs.graymatter.codegen;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.valkyrlabs.ThorAPI;
import com.valkyrlabs.ThorApiRulesValidator;
import com.valkyrlabs.thorapi.BundleAssembler;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;

/** Strict bundle composition followed by the canonical ThorAPI enhancement pass. */
public final class GrayMatterSchemaPipeline {

    private static final String CRUD_INCLUDE = "thorapi/openapi/api_inc.hbs.yaml";

    private GrayMatterSchemaPipeline() {
    }

    public static void main(String[] args) throws Exception {
        Options options = Options.parse(args);
        Files.createDirectories(options.outputDirectory());
        List<Path> sources = sourceFiles(options);
        if (sources.isEmpty()) {
            throw new IllegalArgumentException("No OpenAPI YAML bundles were found");
        }
        validateNoConflictingDefinitions(sources);

        Path stage = Files.createTempDirectory("graymatter-schema-bundles-");
        try {
            for (int index = 0; index < sources.size(); index++) {
                Path source = sources.get(index);
                Files.copy(source, stage.resolve("%03d-%s".formatted(index, source.getFileName())),
                    StandardCopyOption.REPLACE_EXISTING);
            }

            Path composed = options.outputDirectory().resolve("api.hbs.yaml");
            if (!new BundleAssembler().assembleSpecs(stage.toString(), composed.toString())) {
                throw new IllegalStateException("ThorAPI did not compose the GrayMatter bundles");
            }
            preserveCompositionSurface(composed, sources);

            Path include = options.outputDirectory().resolve("api_inc.hbs.yaml");
            writeCrudInclude(include);
            List<String> ruleErrors = new ThorApiRulesValidator().validate(loadYaml(composed));
            if (!ruleErrors.isEmpty()) {
                throw new IllegalArgumentException(
                    "ThorAPI rules rejected the composed schema:\n - " + String.join("\n - ", ruleErrors));
            }

            Path enhanced = options.outputDirectory().resolve("api-out.yaml");
            Path derivedJson = options.outputDirectory().resolve("api-out.json");
            ThorAPI.main(new String[] {
                composed.toString(), composed.toString(), enhanced.toString(), derivedJson.toString()
            });

            Map<String, Object> composedDocument = loadYaml(composed);
            Map<String, Object> enhancedDocument = loadYaml(enhanced);
            normalizeGeneratedDocument(enhancedDocument);
            Map<String, Object> canonicalDocument = canonicalMap(enhancedDocument);
            writeYaml(enhanced, canonicalDocument);
            new ObjectMapper().writeValue(derivedJson.toFile(), canonicalDocument);
            validateEnhancedDocument(composedDocument, canonicalDocument);
            writeManifest(options.outputDirectory(), sources, composedDocument, canonicalDocument);
        } finally {
            deleteTree(stage);
        }
    }

    private static List<Path> sourceFiles(Options options) throws IOException {
        List<Path> sources = new ArrayList<>();
        try (var stream = Files.list(options.bundlesDirectory())) {
            stream.filter(Files::isRegularFile)
                .filter(GrayMatterSchemaPipeline::isYaml)
                .sorted()
                .forEach(sources::add);
        }
        for (Path extension : options.extensions()) {
            Path normalized = extension.toAbsolutePath().normalize();
            if (!Files.isRegularFile(normalized) || !isYaml(normalized)) {
                throw new IllegalArgumentException("Extension is not a readable YAML file: " + extension);
            }
            sources.add(normalized);
        }
        return sources;
    }

    private static boolean isYaml(Path path) {
        String name = path.getFileName().toString().toLowerCase();
        return name.endsWith(".yaml") || name.endsWith(".yml");
    }

    private static void validateNoConflictingDefinitions(List<Path> sources) throws IOException {
        Map<String, Path> schemas = new LinkedHashMap<>();
        Map<String, Path> paths = new LinkedHashMap<>();
        for (Path source : sources) {
            Map<String, Object> document = loadYaml(source);
            requireOpenApiDocument(source, document);
            collectUnique(source, "schema", nestedMap(document, "components", "schemas"), schemas);
            collectUnique(source, "path", map(document.get("paths")), paths);
        }
    }

    private static void collectUnique(
        Path source,
        String kind,
        Map<String, Object> definitions,
        Map<String, Path> owners) {
        for (String name : definitions.keySet()) {
            Path previous = owners.putIfAbsent(name, source);
            if (previous != null) {
                throw new IllegalArgumentException(
                    "Conflicting " + kind + " '" + name + "' in " + previous + " and " + source);
            }
        }
    }

    private static void requireOpenApiDocument(Path source, Map<String, Object> document) {
        if (!(document.get("openapi") instanceof String)
            || !(document.get("info") instanceof Map<?, ?>)
            || !(document.get("paths") instanceof Map<?, ?>)
            || nestedMap(document, "components", "schemas").isEmpty()) {
            throw new IllegalArgumentException(
                "Bundle must contain openapi, info, paths, and components.schemas: " + source);
        }
    }

    /** Retain OpenAPI surfaces that ThorAPI's current BundleAssembler does not merge. */
    private static void preserveCompositionSurface(Path composed, List<Path> sources) throws IOException {
        Map<String, Object> combined = loadYaml(composed);
        Map<String, Object> combinedComponents = mutableMap(combined, "components");
        for (Path source : sources) {
            Map<String, Object> document = loadYaml(source);
            for (Map.Entry<String, Object> entry : document.entrySet()) {
                if (entry.getKey().startsWith("x-")
                    || entry.getKey().equals("security")
                    || entry.getKey().equals("externalDocs")) {
                    mergeUnique(combined, entry.getKey(), entry.getValue(), source, "top-level surface");
                }
            }
            for (Map.Entry<String, Object> section : map(document.get("components")).entrySet()) {
                if (section.getKey().equals("schemas") || section.getKey().equals("securitySchemes")) {
                    continue;
                }
                Map<String, Object> target = mutableMap(combinedComponents, section.getKey());
                for (Map.Entry<String, Object> definition : map(section.getValue()).entrySet()) {
                    mergeUnique(target, definition.getKey(), definition.getValue(), source,
                        "components." + section.getKey());
                }
            }
        }
        writeYaml(composed, combined);
    }

    private static void mergeUnique(
        Map<String, Object> target,
        String key,
        Object value,
        Path source,
        String surface) {
        Object existing = target.get(key);
        if (existing != null && !existing.equals(value)) {
            throw new IllegalArgumentException(
                "Conflicting " + surface + " '" + key + "' while composing " + source);
        }
        target.putIfAbsent(key, value);
    }

    private static void writeCrudInclude(Path destination) throws IOException {
        try (InputStream input = GrayMatterSchemaPipeline.class.getClassLoader()
            .getResourceAsStream(CRUD_INCLUDE)) {
            if (input == null) {
                throw new IOException("ThorAPI resource is missing: " + CRUD_INCLUDE);
            }
            String template = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            String each = "{{#each schemas as |schema key|}}";
            String end = "{{/each}}";
            if (!template.contains(each) || !template.contains(end)) {
                throw new IOException("ThorAPI CRUD include has an unsupported structure");
            }
            template = template.replace(each, each + "\n{{^schema.x-thorapi-nonCrud}}")
                .replace(end, "{{/schema.x-thorapi-nonCrud}}\n" + end);
            Files.writeString(destination, template, StandardCharsets.UTF_8);
        }
    }

    private static void normalizeGeneratedDocument(Map<String, Object> document) {
        for (Object schemaValue : nestedMap(document, "components", "schemas").values()) {
            Map<String, Object> properties = map(map(schemaValue).get("properties"));
            for (String generatedAuditProperty : List.of(
                "id", "ownerId", "createdDate", "lastAccessedById", "lastAccessedDate",
                "lastModifiedById", "lastModifiedDate")) {
                Object property = properties.get(generatedAuditProperty);
                if (property instanceof Map<?, ?>) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> mutableProperty = (Map<String, Object>) property;
                    mutableProperty.remove("example");
                }
            }
        }
        Map<String, Object> health = map(document.get("x-thorapi-generation-health"));
        health.remove("generatedAt");
        health.put("inputSpec", "api.hbs.yaml");
        health.put("templateSpec", "api.hbs.yaml");
        health.put("outputSpec", "api-out.yaml");
        health.put("diagnostic", "status=" + health.get("status")
            + "; pathInjectionState=" + health.get("pathInjectionState")
            + "; inputPathCount=" + health.get("inputPathCount")
            + "; outputPathCount=" + health.get("outputPathCount"));
    }

    @SuppressWarnings("unchecked")
    private static Object canonicalValue(Object value) {
        if (value instanceof Map<?, ?> source) {
            Map<String, Object> sorted = new TreeMap<>();
            for (Map.Entry<?, ?> entry : source.entrySet()) {
                sorted.put(String.valueOf(entry.getKey()), canonicalValue(entry.getValue()));
            }
            return sorted;
        }
        if (value instanceof List<?> source) {
            List<Object> values = new ArrayList<>(source.size());
            for (Object item : source) {
                values.add(canonicalValue(item));
            }
            return values;
        }
        return value;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> canonicalMap(Map<String, Object> value) {
        return (Map<String, Object>) canonicalValue(value);
    }

    private static void validateEnhancedDocument(
        Map<String, Object> composed,
        Map<String, Object> enhanced) {
        Map<String, Object> inputSchemas = nestedMap(composed, "components", "schemas");
        Map<String, Object> outputSchemas = nestedMap(enhanced, "components", "schemas");
        Set<String> missingSchemas = new LinkedHashSet<>(inputSchemas.keySet());
        missingSchemas.removeAll(outputSchemas.keySet());
        if (!missingSchemas.isEmpty()) {
            throw new IllegalStateException("ThorAPI omitted composed schemas: " + missingSchemas);
        }
        Map<String, Object> health = map(enhanced.get("x-thorapi-generation-health"));
        if (!"ok".equals(String.valueOf(health.get("status")))) {
            throw new IllegalStateException("ThorAPI generation health is not ok: " + health);
        }
        Map<String, Object> paths = map(enhanced.get("paths"));
        for (String requiredPath : List.of(
            "/MemoryEntry", "/MemoryEntry/{id}", "/GrayMatter", "/GrayMatter/{id}",
            "/MemoryEntry/query", "/memory/status", "/api-docs")) {
            if (!paths.containsKey(requiredPath)) {
                throw new IllegalStateException("ThorAPI output is missing required path " + requiredPath);
            }
        }
    }

    private static void writeManifest(
        Path outputDirectory,
        List<Path> sources,
        Map<String, Object> composed,
        Map<String, Object> enhanced) throws Exception {
        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("format", "graymatter-thorapi-generation/v1");
        manifest.put("thorapiVersion", "1.0.3-SNAPSHOT");
        List<Map<String, String>> inputs = new ArrayList<>();
        for (Path source : sources) {
            Map<String, String> input = new LinkedHashMap<>();
            input.put("path", source.getFileName().toString());
            input.put("sha256", sha256(Files.readAllBytes(source)));
            inputs.add(input);
        }
        manifest.put("inputs", inputs);
        manifest.put("schemaCount", nestedMap(enhanced, "components", "schemas").size());
        manifest.put("pathCount", map(enhanced.get("paths")).size());
        manifest.put("sourceSchemaCount", nestedMap(composed, "components", "schemas").size());
        manifest.put("generationHealth", enhanced.get("x-thorapi-generation-health"));
        ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
        mapper.writeValue(outputDirectory.resolve("generation-manifest.json").toFile(), manifest);
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> loadYaml(Path path) throws IOException {
        LoaderOptions options = new LoaderOptions();
        options.setCodePointLimit(16 * 1024 * 1024);
        options.setMaxAliasesForCollections(50);
        options.setNestingDepthLimit(50);
        try (InputStream input = Files.newInputStream(path)) {
            Object loaded = new Yaml(options).load(input);
            if (!(loaded instanceof Map<?, ?>)) {
                throw new IllegalArgumentException("OpenAPI YAML is not an object: " + path);
            }
            return (Map<String, Object>) loaded;
        }
    }

    private static void writeYaml(Path destination, Map<String, Object> document) throws IOException {
        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setPrettyFlow(true);
        options.setIndent(2);
        options.setIndicatorIndent(2);
        options.setIndentWithIndicator(true);
        Files.writeString(destination, new Yaml(options).dump(document));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mutableMap(Map<String, Object> parent, String key) {
        Object value = parent.get(key);
        if (value instanceof Map<?, ?>) {
            return (Map<String, Object>) value;
        }
        Map<String, Object> created = new LinkedHashMap<>();
        parent.put(key, created);
        return created;
    }

    private static Map<String, Object> nestedMap(Map<String, Object> root, String first, String second) {
        return map(map(root.get(first)).get(second));
    }

    private static void deleteTree(Path root) throws IOException {
        if (root == null || !Files.exists(root)) {
            return;
        }
        try (var paths = Files.walk(root)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    private record Options(Path bundlesDirectory, Path outputDirectory, List<Path> extensions) {
        private static Options parse(String[] args) {
            Path bundles = null;
            Path output = null;
            List<Path> extensions = new ArrayList<>();
            for (int index = 0; index < args.length; index++) {
                switch (args[index]) {
                    case "--bundles-dir" -> bundles = Path.of(requireValue(args, ++index, "--bundles-dir"));
                    case "--out-dir" -> output = Path.of(requireValue(args, ++index, "--out-dir"));
                    case "--extension" -> extensions.add(Path.of(requireValue(args, ++index, "--extension")));
                    default -> throw new IllegalArgumentException("Unknown argument: " + args[index]);
                }
            }
            if (bundles == null || output == null) {
                throw new IllegalArgumentException(
                    "Usage: GrayMatterSchemaPipeline --bundles-dir DIR --out-dir DIR [--extension FILE]");
            }
            return new Options(
                bundles.toAbsolutePath().normalize(),
                output.toAbsolutePath().normalize(),
                List.copyOf(extensions));
        }

        private static String requireValue(String[] args, int index, String option) {
            if (index >= args.length || args[index].isBlank()) {
                throw new IllegalArgumentException(option + " requires a value");
            }
            return args[index];
        }
    }
}
