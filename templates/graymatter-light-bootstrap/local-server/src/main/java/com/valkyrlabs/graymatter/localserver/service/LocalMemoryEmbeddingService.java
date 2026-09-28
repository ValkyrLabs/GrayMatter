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
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Offline vector baseline with optional loopback-only Ollama semantic embeddings. */
@Service
public class LocalMemoryEmbeddingService {
    public static final String HASH_PROFILE = "feature-hash-384-v1";
    private static final int DIMENSIONS = 384;
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]+", Pattern.UNICODE_CHARACTER_CLASS);
    private final ObjectMapper mapper;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1)).build();
    private final String provider;
    private final String model;
    private final AtomicLong unavailableUntil = new AtomicLong();

    public LocalMemoryEmbeddingService(ObjectMapper mapper,
        @Value("${graymatter.embedding.provider:feature-hash}") String provider,
        @Value("${graymatter.embedding.ollama.model:nomic-embed-text}") String model) {
        this.mapper = mapper;
        this.provider = provider.toLowerCase(Locale.ROOT);
        this.model = model;
        if (!this.provider.equals("feature-hash") && !this.provider.equals("ollama")) {
            throw new IllegalArgumentException("Unsupported local embedding provider");
        }
        if (model == null || model.isBlank() || model.length() > 100
            || !model.matches("[A-Za-z0-9._:/-]+")) {
            throw new IllegalArgumentException("Invalid local embedding model name");
        }
    }

    public boolean semanticConfigured() { return provider.equals("ollama"); }
    public String semanticProfile() { return "ollama:" + model; }

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
            String body = mapper.writeValueAsString(java.util.Map.of("model", model,
                "input", text.length() > 16000 ? text.substring(0, 16000) : text));
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:11434/api/embed"))
                .timeout(Duration.ofSeconds(3))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)).build();
            HttpResponse<String> response = client.send(request,
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != 200 || response.body().length() > 2_000_000) {
                unavailableUntil.set(System.currentTimeMillis() + 60_000);
                return null;
            }
            JsonNode embeddings = mapper.readTree(response.body()).path("embeddings");
            if (!embeddings.isArray() || embeddings.isEmpty() || !embeddings.get(0).isArray()) return null;
            JsonNode values = embeddings.get(0);
            if (values.size() < 32 || values.size() > 4096) return null;
            float[] vector = new float[values.size()];
            for (int i = 0; i < values.size(); i++) {
                if (!values.get(i).isNumber()) return null;
                vector[i] = (float) values.get(i).asDouble();
                if (!Float.isFinite(vector[i])) return null;
            }
            unavailableUntil.set(0);
            return normalize(vector);
        } catch (Exception ignored) {
            // A missing local model degrades to the always-available feature-hash index.
            unavailableUntil.set(System.currentTimeMillis() + 60_000);
            return null;
        }
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
