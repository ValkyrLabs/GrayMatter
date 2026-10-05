package com.valkyrlabs.graymatter.localserver.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Offline vector baseline with optional loopback-only semantic embeddings.
 *
 * <p>Providers: {@code feature-hash} (default, always available), {@code ollama}
 * (native {@code POST /api/embed}), and {@code openai} for any OpenAI-compatible
 * {@code POST /embeddings} server such as LM Studio, llama.cpp {@code llama-server}
 * or vLLM ({@code lmstudio} is an alias that defaults to LM Studio's port). LM Studio
 * does not implement Ollama's native API: it answers {@code /api/embed} with HTTP 200
 * and an error body, so it needs the {@code openai} provider.
 *
 * <p>The base URL must stay on loopback. An OpenAI-compatible server may answer a
 * request for an unknown model with whatever model is loaded (LM Studio does); a
 * response naming a different model is refused so one index never mixes vector spaces.
 */
@Service
public class LocalMemoryEmbeddingService {
    public static final String HASH_PROFILE = "feature-hash-384-v1";
    private static final int DIMENSIONS = 384;
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]+", Pattern.UNICODE_CHARACTER_CLASS);
    private static final Set<String> PROVIDERS = Set.of("feature-hash", "ollama", "openai", "lmstudio");
    private static final Set<String> LOOPBACK_HOSTS = Set.of("127.0.0.1", "localhost", "::1", "[::1]");
    private final ObjectMapper mapper;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();
    private final String provider;
    private final String model;
    private final URI endpoint;
    private final Duration timeout;
    private final AtomicLong unavailableUntil = new AtomicLong();

    public LocalMemoryEmbeddingService(ObjectMapper mapper,
        @Value("${graymatter.embedding.provider:feature-hash}") String provider,
        @Value("${graymatter.embedding.ollama.model:nomic-embed-text}") String ollamaModel,
        @Value("${graymatter.embedding.model:}") String model,
        @Value("${graymatter.embedding.base-url:}") String baseUrl,
        @Value("${graymatter.embedding.timeout-ms:3000}") long timeoutMs) {
        this.mapper = mapper;
        this.provider = provider.toLowerCase(Locale.ROOT).trim();
        if (!PROVIDERS.contains(this.provider)) {
            throw new IllegalArgumentException("Unsupported local embedding provider");
        }
        // graymatter.embedding.model wins; the Ollama-specific property stays for existing setups.
        this.model = model == null || model.isBlank() ? ollamaModel : model.trim();
        if (this.model == null || this.model.isBlank() || this.model.length() > 100
            || !this.model.matches("[A-Za-z0-9._:/@-]+")) {
            throw new IllegalArgumentException("Invalid local embedding model name");
        }
        if (timeoutMs < 100 || timeoutMs > 120_000) {
            throw new IllegalArgumentException("Embedding timeout must be between 100 and 120000 ms");
        }
        this.timeout = Duration.ofMillis(timeoutMs);
        this.endpoint = semanticConfigured() ? endpointFor(this.provider, baseUrl) : null;
    }

    public boolean semanticConfigured() { return !provider.equals("feature-hash"); }
    public String semanticProfile() { return provider + ":" + model; }

    /** The embeddings URL for a provider, refusing anything that is not loopback HTTP. */
    static URI endpointFor(String provider, String baseUrl) {
        String base = baseUrl == null || baseUrl.isBlank()
            ? switch (provider) {
                case "ollama" -> "http://127.0.0.1:11434";
                case "lmstudio" -> "http://127.0.0.1:1234/v1";
                // No guess for a generic server: its port varies, and a wrong guess could hit another service.
                default -> throw new IllegalArgumentException(
                    "graymatter.embedding.base-url is required for the openai provider");
            }
            : baseUrl.trim();
        base = base.replaceAll("/+$", "");
        URI uri = URI.create(base + (provider.equals("ollama") ? "/api/embed" : "/embeddings"));
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        if (!"http".equals(uri.getScheme()) || !LOOPBACK_HOSTS.contains(host) || uri.getUserInfo() != null) {
            throw new IllegalArgumentException("Embedding base URL must be http:// on loopback (127.0.0.1, localhost or ::1)");
        }
        return uri;
    }

    public float[] featureHash(String text) {
        float[] vector = new float[DIMENSIONS];
        Matcher words = WORD.matcher(text.toLowerCase(Locale.ROOT));
        while (words.find()) {
            String word = words.group();
            add(vector, "w:" + word, 1.0f);
            if (word.length() >= 4) {
                String wrapped = "^" + word + "$";
                for (int i = 0; i <= wrapped.length() - 3; i++) {
                    add(vector, "c:" + wrapped.substring(i, i + 3), 0.25f);
                }
            }
        }
        return normalize(vector);
    }

    public float[] semantic(String text) {
        if (!semanticConfigured() || System.currentTimeMillis() < unavailableUntil.get()) return null;
        try {
            String input = text.length() > 16000 ? text.substring(0, 16000) : text;
            String body = mapper.writeValueAsString(Map.of("model", model, "input", input));
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
            HttpResponse<String> response = client.send(request,
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200 || response.body().length() > 2_000_000) {
                unavailableUntil.set(System.currentTimeMillis() + 60_000);
                return null;
            }
            float[] vector = parse(mapper.readTree(response.body()));
            if (vector == null) {
                // An error body with HTTP 200 (LM Studio on an unsupported route) or a substituted model.
                unavailableUntil.set(System.currentTimeMillis() + 60_000);
                return null;
            }
            unavailableUntil.set(0);
            return normalize(vector);
        } catch (Exception ignored) {
            // A missing local model degrades to the always-available feature-hash index.
            unavailableUntil.set(System.currentTimeMillis() + 60_000);
            return null;
        }
    }

    /** The first embedding in an Ollama ({@code embeddings}) or OpenAI ({@code data[].embedding}) response. */
    float[] parse(JsonNode root) {
        JsonNode values;
        if (provider.equals("ollama")) {
            JsonNode embeddings = root.path("embeddings");
            if (!embeddings.isArray() || embeddings.isEmpty()) return null;
            values = embeddings.get(0);
        } else {
            String answered = root.path("model").asText("");
            if (!answered.isEmpty() && !answered.equals(model)) return null;
            JsonNode data = root.path("data");
            if (!data.isArray() || data.isEmpty()) return null;
            values = data.get(0).path("embedding");
        }
        if (values == null || !values.isArray() || values.size() < 32 || values.size() > 4096) return null;
        float[] vector = new float[values.size()];
        for (int i = 0; i < values.size(); i++) {
            if (!values.get(i).isNumber()) return null;
            vector[i] = (float) values.get(i).asDouble();
            if (!Float.isFinite(vector[i])) return null;
        }
        return vector;
    }

    public static String encode(float[] vector) {
        ByteBuffer bytes = ByteBuffer.allocate(vector.length * Float.BYTES).order(ByteOrder.LITTLE_ENDIAN);
        for (float value : vector) bytes.putFloat(value);
        return Base64.getEncoder().encodeToString(bytes.array());
    }

    public static float[] decode(String encoded) {
        if (encoded == null) return null;
        try {
            byte[] bytes = Base64.getDecoder().decode(encoded);
            if (bytes.length % 4 != 0 || bytes.length < 32 * 4 || bytes.length > 4096 * 4) return null;
            ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
            float[] result = new float[bytes.length / 4];
            for (int i = 0; i < result.length; i++) {
                result[i] = buffer.getFloat();
                if (!Float.isFinite(result[i])) return null;
            }
            return result;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    public static double cosine(float[] left, float[] right) {
        if (left == null || right == null || left.length != right.length) return 0;
        double score = 0;
        for (int i = 0; i < left.length; i++) score += left[i] * right[i];
        return Math.max(0, score);
    }

    private static void add(float[] vector, String feature, float weight) {
        int hash = feature.hashCode();
        vector[Math.floorMod(hash, vector.length)] += (hash & 0x10000) == 0 ? weight : -weight;
    }

    private static float[] normalize(float[] vector) {
        double norm = 0;
        for (float value : vector) norm += value * value;
        if (norm > 0) {
            float factor = (float) (1.0 / Math.sqrt(norm));
            for (int i = 0; i < vector.length; i++) vector[i] *= factor;
        }
        return vector;
    }
}
