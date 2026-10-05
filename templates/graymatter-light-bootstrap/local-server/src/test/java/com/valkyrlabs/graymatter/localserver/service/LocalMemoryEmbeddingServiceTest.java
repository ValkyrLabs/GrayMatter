package com.valkyrlabs.graymatter.localserver.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * Embedding providers against a loopback stand-in server. The LM Studio cases
 * reproduce what LM Studio 0.3.x does (measured 2026-09-30): Ollama's
 * {@code /api/embed} gets HTTP 200 with an error body, and an unknown model is
 * answered with the loaded one, named in the response's {@code model} field.
 */
class LocalMemoryEmbeddingServiceTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String MODEL = "text-embedding-nomic-embed-text-v1.5";
    private HttpServer server;
    private final List<String> requests = new CopyOnWriteArrayList<>();

    @AfterEach
    void stop() {
        if (server != null) server.stop(0);
    }

    /** A loopback server answering every path with {@code body} (HTTP 200), recording "PATH BODY". */
    private String serve(String body) throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.add(exchange.getRequestURI().getPath() + " "
                + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static String vector(int dims) {
        return IntStream.range(0, dims).mapToObj(i -> "0." + (i % 9 + 1)).collect(Collectors.joining(",", "[", "]"));
    }

    private static LocalMemoryEmbeddingService service(String provider, String model, String baseUrl) {
        return new LocalMemoryEmbeddingService(MAPPER, provider, "nomic-embed-text", model, baseUrl, 3000);
    }

    @Test
    void lmStudioIsServedThroughTheOpenAiCompatibleRoute() throws Exception {
        String base = serve("{\"object\":\"list\",\"model\":\"" + MODEL + "\",\"data\":[{\"index\":0,\"embedding\":"
            + vector(768) + "}]}");
        LocalMemoryEmbeddingService embeddings = service("lmstudio", MODEL, base + "/v1");

        float[] result = embeddings.semantic("account lockout");

        assertThat(result).hasSize(768);
        assertThat(embeddings.semanticProfile()).isEqualTo("lmstudio:" + MODEL);
        assertThat(requests).singleElement().satisfies(r -> {
            assertThat(r).startsWith("/v1/embeddings ");
            assertThat(r).contains("\"model\":\"" + MODEL + "\"", "\"input\":\"account lockout\"");
        });
    }

    @Test
    void aSubstitutedModelIsRefusedSoTheIndexNeverMixesVectorSpaces() throws Exception {
        String base = serve("{\"model\":\"some-other-model\",\"data\":[{\"index\":0,\"embedding\":" + vector(768) + "}]}");
        assertThat(service("openai", MODEL, base + "/v1").semantic("x")).isNull();
    }

    @Test
    void anErrorBodyWithHttp200IsNotAnEmbedding() throws Exception {
        String base = serve("{\"error\":\"Unexpected endpoint or method. (POST /api/embed)\"}");
        assertThat(service("ollama", MODEL, base).semantic("x")).isNull();
        assertThat(service("openai", MODEL, base + "/v1").semantic("x")).isNull();
    }

    @Test
    void ollamaKeepsItsNativeApiAndLegacyModelProperty() throws Exception {
        String base = serve("{\"model\":\"nomic-embed-text\",\"embeddings\":[" + vector(768) + "]}");
        LocalMemoryEmbeddingService embeddings = new LocalMemoryEmbeddingService(MAPPER, "ollama", "nomic-embed-text", "", base, 3000);

        assertThat(embeddings.semantic("x")).hasSize(768);
        assertThat(embeddings.semanticProfile()).isEqualTo("ollama:nomic-embed-text");
        assertThat(requests).singleElement().satisfies(r -> assertThat(r).startsWith("/api/embed "));
    }

    @Test
    void defaultsAndLoopbackOnly() {
        assertThat(LocalMemoryEmbeddingService.endpointFor("ollama", "")).hasToString("http://127.0.0.1:11434/api/embed");
        assertThat(LocalMemoryEmbeddingService.endpointFor("lmstudio", null)).hasToString("http://127.0.0.1:1234/v1/embeddings");
        assertThat(LocalMemoryEmbeddingService.endpointFor("openai", "http://localhost:8081/v1/")).hasToString("http://localhost:8081/v1/embeddings");
        assertThatThrownBy(() -> LocalMemoryEmbeddingService.endpointFor("openai", "")).hasMessageContaining("base-url is required");
        assertThatThrownBy(() -> LocalMemoryEmbeddingService.endpointFor("openai", "https://api.openai.com/v1")).hasMessageContaining("loopback");
        assertThatThrownBy(() -> LocalMemoryEmbeddingService.endpointFor("lmstudio", "http://10.0.0.5:1234/v1")).hasMessageContaining("loopback");
        assertThatThrownBy(() -> LocalMemoryEmbeddingService.endpointFor("lmstudio", "http://user:pw@127.0.0.1:1234/v1")).hasMessageContaining("loopback");
    }

    @Test
    void featureHashNeedsNoServer() {
        LocalMemoryEmbeddingService embeddings = service("feature-hash", "", "");
        assertThat(embeddings.semanticConfigured()).isFalse();
        assertThat(embeddings.semantic("x")).isNull();
        assertThat(embeddings.featureHash("account lockout")).hasSize(384);
    }
}
